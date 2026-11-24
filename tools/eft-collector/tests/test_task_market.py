"""Check boundaries between templates, live prices and actual quest definitions."""
import unittest

from analyze_task_market import derive


class TaskMarketTests(unittest.TestCase):
    def test_base_price_missing_flags_and_category_nodes_are_not_market_prices(self):
        counts, files = derive({
            "items": {
                "one": {"_type": "Item", "_name": "one", "_props": {"CanSellOnRagfair": True}},
                "two": {"_type": "Item", "_name": "two", "_props": {}},
                "node": {"_type": "Node", "_props": {"CanSellOnRagfair": True}},
            },
            "handbook": {"Items": [{"Id": "one", "Price": 0, "ParentId": "category"}]},
        })
        self.assertEqual(counts["flea-item-catalog"]["items"], 2)
        self.assertEqual(counts["flea-item-catalog"]["CanSellOnRagfairMissing"], 1)
        self.assertEqual(counts["flea-item-catalog"]["handbookBasePricesLinked"], 1)
        self.assertTrue(all(r["liveMarketPrice"] is None for r in files["flea-item-catalog.json"]))
        self.assertEqual(files["flea-item-catalog.json"][0]["handbookBasePrice"], 0)

    def test_only_explicit_quest_references_and_original_condition_flags_survive(self):
        condition = {"QuestId": "quest-1", "Started": True, "Completed": True, "Failed": False}
        counts, files = derive({
            "items": {"item": {"_type": "Item", "_props": {
                "QuestItem": False, "QuestConditions": [condition]}}},
            "main-quest-notes": [{
                "id": "note", "chapterId": "chapter", "conditionIds": ["not-a-quest"],
                "links": {"items": [{"id": "link", "quests": ["quest-1"]}], "crafts": [], "offers": []},
            }],
        })
        self.assertEqual(counts["task-reference-index"]["uniqueQuestIds"], 1)
        row = files["task-reference-index.json"][0]
        self.assertEqual(row["questId"], "quest-1")
        self.assertFalse(row["fullTemplateAvailable"])
        self.assertEqual(row["references"][0]["sourceCondition"], condition)
        self.assertEqual(counts["task-item-references"]["QuestItemTrue"], 0)
        self.assertEqual(counts["task-item-references"]["items"], 1)

    def test_only_ragfair_subtree_is_exported_from_globals(self):
        _, files = derive({"globals": {"config": {
            "RagFair": {"minUserLevel": 15, "ItemRestrictions": []},
            "unrelatedPrivateData": ["not-for-export"],
        }}})
        self.assertEqual(files, {"flea-rules.json": {"minUserLevel": 15, "ItemRestrictions": []}})


if __name__ == "__main__":
    unittest.main()
