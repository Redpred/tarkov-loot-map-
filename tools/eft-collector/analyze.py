"""Offline analysis of verified collector captures; never makes requests.

Produces a new, provenance-bearing directory. Existing outputs and source
captures are never overwritten. Account/profile endpoints are not inputs.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from analyze_task_market import derive

INPUTS = {"items", "customization", "hideout-recipes", "main-quests",
          "menu-locale-ch", "hideout-qte", "prestige", "main-quest-notes",
          "tapes", "subtitle-tracks", "globals", "handbook"}
TARGETS = INPUTS - {"customization", "hideout-recipes", "main-quests", "handbook"}


def load(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def latest_inputs(root):
    selected = {}
    for path in root.glob("*/manifest.json"):
        manifest = load(path)
        endpoint = manifest.get("endpoint")
        receipt = manifest.get("receipt", {})
        if endpoint not in INPUTS or receipt.get("success") is not True:
            continue
        if endpoint not in selected or receipt["at"] > selected[endpoint][1]["receipt"]["at"]:
            selected[endpoint] = (path, manifest)
    data, provenance = {}, {}
    for endpoint, (path, manifest) in selected.items():
        source = path.parent / "response.json"
        expected = manifest["files"]["response.json"]
        if source.stat().st_size != expected["bytes"] or digest(source) != expected["sha256"]:
            raise ValueError(f"input-hash-mismatch:{endpoint}")
        response = load(source)
        if response.get("err") != 0:
            raise ValueError(f"input-business-error:{endpoint}")
        data[endpoint] = response["data"]
        provenance[endpoint] = {
            "captureId": path.parent.name, "manifest": str(path.resolve()),
            "manifestSha256": digest(path), "responseSha256": expected["sha256"],
            "capturedAt": manifest["receipt"]["at"],
            "requestedGameVersion": manifest["requestedGameVersion"],
            "backend": manifest["backend"], "path": manifest["receipt"]["path"],
        }
    versions = {v["requestedGameVersion"] for v in provenance.values()}
    if len(versions) > 1:
        raise ValueError("mixed-client-versions-use-an-isolated-capture-directory")
    if not TARGETS.intersection(data):
        raise ValueError("no-supported-captures")
    return data, provenance


def analyze(data):
    items = data.get("items", {})
    cosmetics = data.get("customization", {})
    recipes = {r["_id"]: r for r in data.get("hideout-recipes", {}).get("recipes", [])}
    chapter_ids = {r["ChapterId"] for r in data.get("main-quests", {}).get("chapters", [])}
    counts, outputs = {}, {}

    def item_ref(template):
        row = items.get(template)
        return {"templateId": template, "resolved": row is not None,
                "internalName": row.get("_name") if row else None}

    def item_instances(rows):
        return [{**item_ref(r["_tpl"]), "instanceId": r["_id"],
                 "count": r.get("upd", {}).get("StackObjectsCount")} for r in rows]

    if "main-quest-notes" in data:
        rows = data["main-quest-notes"]
        linked = []
        item_refs = []
        recipe_matches = 0
        for note in rows:
            links = note["links"]
            refs = [item_ref(x["templateId"]) for x in links["items"]]
            item_refs.extend(refs)
            craft_links = []
            for craft in links["crafts"]:
                recipe = recipes.get(craft["id"])
                recipe_matches += recipe is not None
                products = item_instances(craft["item"])
                item_refs.extend(products)
                craft_links.append({"linkId": craft["id"], "area": craft["area"],
                                    "questIds": craft["quests"], "products": products,
                                    "recipeIdMatched": recipe is not None,
                                    "recipeProductionTime": recipe.get("productionTime") if recipe else None})
            offer_links = []
            for offer in links["offers"]:
                products = item_instances(offer["item"])
                item_refs.extend(products)
                offer_links.append({"linkId": offer["id"], "traderId": offer["traderId"],
                                    "questIds": offer["quests"], "items": products})
            linked.append({"source": note, "resolvedReferences": {
                "knownChapter": note["chapterId"] in chapter_ids,
                "items": refs, "crafts": craft_links, "offers": offer_links}})
        counts["main-quest-notes"] = {
            "notes": len(rows), "chapters": len({r["chapterId"] for r in rows}),
            "notesWithUnknownChapter": sum(r["chapterId"] not in chapter_ids for r in rows),
            "conditionReferences": sum(len(r["conditionIds"]) for r in rows),
            "links": {key: sum(len(r["links"][key]) for r in rows) for key in ("items", "crafts", "offers")},
            "itemTemplateReferences": len(item_refs),
            "resolvedItemTemplateReferences": sum(r["resolved"] for r in item_refs),
            "craftLinksMatchedToRecipesById": recipe_matches,
            "notesByChapter": dict(Counter(r["chapterId"] for r in rows)),
        }
        outputs["main-quest-notes-linked.json"] = linked
    if "prestige" in data:
        rows = data["prestige"]["elements"]
        parsed = []
        for row in rows:
            rewards = []
            for reward in row["rewards"]:
                result = {"source": reward}
                if reward["type"] == "Item":
                    result["resolvedItems"] = item_instances(reward.get("items", []))
                elif reward["type"] == "CustomizationDirect":
                    cosmetic = cosmetics.get(reward["target"])
                    result["resolvedCustomization"] = {
                        "id": reward["target"], "resolved": cosmetic is not None,
                        "internalName": cosmetic.get("_name") if cosmetic else None}
                rewards.append(result)
            parsed.append({"id": row["id"], "conditions": row["conditions"],
                           "rewards": rewards, "transferConfigs": row["transferConfigs"],
                           "image": row.get("image"), "bigImage": row.get("bigImage")})
        counts["prestige"] = {
            "elements": len(rows), "conditions": sum(len(r["conditions"]) for r in rows),
            "rewards": sum(len(r["rewards"]) for r in rows),
            "conditionTypes": dict(Counter(c["conditionType"] for r in rows for c in r["conditions"])),
            "rewardTypes": dict(Counter(c["type"] for r in rows for c in r["rewards"])),
        }
        outputs["prestige-parsed.json"] = parsed
    if "hideout-qte" in data:
        rows = data["hideout-qte"]
        counts["hideout-qte"] = {
            "configurations": len(rows), "steps": sum(len(r["quickTimeEvents"]) for r in rows),
            "requirements": sum(len(r["requirements"]) for r in rows),
        }
        outputs["training-qte.json"] = rows
    for endpoint in ("tapes", "subtitle-tracks"):
        if endpoint not in data:
            continue
        rows = data[endpoint]
        cues = [s for r in rows for s in r["subtitles"]]
        counts[endpoint] = {
            "records": len(rows), "subtitleCues": len(cues),
            "uniqueSubtitleIds": len({s["id"] for s in cues}),
            "invalidTimeRanges": sum(s["end"] < s["start"] for s in cues),
        }
        outputs[endpoint + "-timelines.json"] = rows
    if "menu-locale-ch" in data:
        menu = data["menu-locale-ch"]["menu"]
        counts["menu-locale-ch"] = {"strings": len(menu)}
        outputs["menu-zh.json"] = menu
    task_market_counts, task_market_outputs = derive(data)
    counts.update(task_market_counts)
    outputs.update(task_market_outputs)
    return counts, outputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--captures", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError("output-exists-choose-a-new-directory")
    data, sources = latest_inputs(args.captures)
    counts, outputs = analyze(data)
    report = {
        "schemaVersion": 1, "generatedAt": datetime.now(timezone.utc).isoformat(),
        "analyzerSha256": digest(Path(__file__)), "networkRequests": 0,
        "sources": sources, "counts": counts,
        "limits": [
            "主线笔记是关联记录，不是完整任务条件、奖励、正文或玩家进度。",
            "关联名称使用同批物品/外观内部名，尚无完整中文本地化。",
            "声望配置含模式、版本与隐藏标志；存在记录不代表当前角色已经可用。",
            "磁带和字幕轨道仅含字幕 ID、start/end，未取得字幕正文或音视频。",
            "时间字段、倍率和奖励权重保留原值，未推断运行时叠加或随机概率。",
            "配方关联仅在 ID 完全一致时确认，不按名称或物品相似性猜测。",
            "跳蚤目录只含模板交易标志及手册基准价，liveMarketPrice 始终为 null；无实时挂单或成交价。",
            "CanSellOnRagfair、物品等级和全局开关保留原值，不据此推断角色、模式或活动下实际可交易性。",
            "任务引用索引仅汇总明确 QuestId/quests 字段，不把 conditionIds 当任务 ID，也不从顺序推断前置。",
            "物品 QuestConditions 是物品模板上的任务关联条件，不是对应任务的完整目标、奖励或玩家进度。",
        ],
    }
    args.output.mkdir(parents=True, exist_ok=False)
    report["files"] = {}
    for name, value in outputs.items():
        path = args.output / name
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
        report["files"][name] = {"bytes": path.stat().st_size, "sha256": digest(path)}
    (args.output / "summary.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(json.dumps({"output": str(args.output.resolve()), "counts": counts}, ensure_ascii=False))


if __name__ == "__main__":
    main()
