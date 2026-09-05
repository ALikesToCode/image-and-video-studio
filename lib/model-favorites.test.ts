import test from "node:test";
import assert from "node:assert/strict";
import { parseModelFavorites, sortFavoriteModels, toggleModelFavorite } from "./model-favorites.ts";

test("favorites reject malformed storage and bound saved model IDs", () => {
  assert.deepEqual(parseModelFavorites("broken"), []);
  assert.deepEqual(parseModelFavorites('{"models":[]}'), []);
  assert.deepEqual(parseModelFavorites('["gguu:model",null,"gguu:model","bad id"]'), ["gguu:model"]);
  assert.equal(parseModelFavorites(JSON.stringify(Array.from({ length: 200 }, (_, i) => `model-${i}`))).length, 100);
});

test("favoriting and unfavoriting preserve stable catalog ordering", () => {
  const models = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const favorites = toggleModelFavorite([], "c");
  assert.deepEqual(sortFavoriteModels(models, new Set(favorites)).map((model) => model.id), ["c", "a", "b"]);
  assert.deepEqual(toggleModelFavorite(favorites, "c"), []);
  assert.deepEqual(models.map((model) => model.id), ["a", "b", "c"]);
});
