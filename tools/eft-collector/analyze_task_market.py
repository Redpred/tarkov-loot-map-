"""Derive task references and flea rules from verified public configuration.

No network, account data, inferred market prices or inferred task definitions.
Item flags describe templates; they do not prove an account can trade an item.
"""
from collections import Counter


FLEA_FIELDS = (
    "CanSellOnRagfair", "CanRequireOnRagfair", "RagfairLevelToTrade",
    "RagFairCommissionModifier", "IsRagfairCurrency", "IsUnbuyable",
    "QuestItem", "StackMaxSize",
)
TASK_FIELDS = (
    "QuestItem", "QuestConditions", "QuestStashMaxCount",
    "IsNotDeletableFromQuestStashAfterQuestComplete",
)


def derive(data):
    counts, outputs = {}, {}
    items = data.get("items", {})
    item_rows = [(key, value) for key, value in items.items()
                 if isinstance(value, dict) and value.get("_type") == "Item"]
    handbook = {r["Id"]: r for r in data.get("handbook", {}).get("Items", [])}
    references = {}

    def ref(quest_id, reference):
        if not isinstance(quest_id, str) or not quest_id:
            return
        references.setdefault(quest_id, []).append(reference)

    if "items" in data:
        catalog, task_items = [], []
        for template_id, item in item_rows:
            props = item.get("_props", {})
            base = handbook.get(template_id)
            catalog.append({
                "templateId": template_id, "internalName": item.get("_name"),
                "parentTemplateId": item.get("_parent"),
                "templateRules": {key: props[key] for key in FLEA_FIELDS if key in props},
                "handbookBasePrice": base.get("Price") if base is not None else None,
                "handbookCategoryId": base.get("ParentId") if base is not None else None,
                "liveMarketPrice": None,
            })
            if props.get("QuestItem") is True or props.get("QuestConditions"):
                task_items.append({
                    "templateId": template_id, "internalName": item.get("_name"),
                    "properties": {key: props[key] for key in TASK_FIELDS if key in props},
                })
            for i, condition in enumerate(props.get("QuestConditions", [])):
                ref(condition.get("QuestId"), {
                    "sourceKind": "item-quest-condition", "templateId": template_id,
                    "conditionIndex": i, "sourceCondition": condition,
                })
        outputs["flea-item-catalog.json"] = catalog
        outputs["task-item-references.json"] = task_items
        counts["flea-item-catalog"] = {
            "items": len(catalog),
            "CanSellOnRagfairTrue": sum(r["templateRules"].get("CanSellOnRagfair") is True for r in catalog),
            "CanSellOnRagfairFalse": sum(r["templateRules"].get("CanSellOnRagfair") is False for r in catalog),
            "CanSellOnRagfairMissing": sum("CanSellOnRagfair" not in r["templateRules"] for r in catalog),
            "CanRequireOnRagfairTrue": sum(r["templateRules"].get("CanRequireOnRagfair") is True for r in catalog),
            "RagfairLevelToTradeValues": dict(Counter(
                str(r["templateRules"].get("RagfairLevelToTrade", "missing")) for r in catalog)),
            "handbookBasePricesLinked": sum(r["handbookBasePrice"] is not None for r in catalog),
            "liveMarketPrices": 0,
        }
        counts["task-item-references"] = {
            "items": len(task_items),
            "QuestItemTrue": sum(r["properties"].get("QuestItem") is True for r in task_items),
            "itemsWithQuestConditions": sum(bool(r["properties"].get("QuestConditions")) for r in task_items),
            "questConditionReferences": sum(len(r["properties"].get("QuestConditions", [])) for r in task_items),
        }

    for note in data.get("main-quest-notes", []):
        for kind in ("items", "crafts", "offers"):
            for link in note["links"].get(kind, []):
                for quest_id in link.get("quests", []):
                    ref(quest_id, {"sourceKind": "main-quest-note-link", "noteId": note["id"],
                                   "chapterId": note["chapterId"], "linkKind": kind, "linkId": link["id"]})
    if references:
        rows = [{"questId": key, "fullTemplateAvailable": False, "references": value}
                for key, value in sorted(references.items())]
        outputs["task-reference-index.json"] = rows
        counts["task-reference-index"] = {
            "uniqueQuestIds": len(rows), "references": sum(len(r["references"]) for r in rows),
            "fullTemplates": 0,
            "referenceKinds": dict(Counter(r["sourceKind"] for refs in references.values() for r in refs)),
        }
    ragfair = data.get("globals", {}).get("config", {}).get("RagFair")
    if isinstance(ragfair, dict):
        outputs["flea-rules.json"] = ragfair
        counts["flea-rules"] = {"configurationFields": len(ragfair),
                               "maxActiveOfferCountBands": len(ragfair.get("maxActiveOfferCount", []))}
    return counts, outputs
