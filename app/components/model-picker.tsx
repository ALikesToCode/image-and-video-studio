"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import type { ModelOption } from "@/lib/constants";
import { ensureSelectedModelOption, filterModelOptions } from "@/lib/model-options";
import { sortFavoriteModels } from "@/lib/model-favorites";
import { useModelFavorites } from "@/app/hooks/use-model-favorites";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export function ModelPicker({ value, onChange, models, scope }: {
  value: string; onChange: (model: string) => void; models: ModelOption[]; scope: string;
}) {
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const { favorites, toggle, error } = useModelFavorites(scope);
  const matches = filterModelOptions(models, query).filter((model) => !favoritesOnly || favorites.has(model.id));
  const visible = sortFavoriteModels(ensureSelectedModelOption(matches, value), favorites);
  return <div className="space-y-2">
    <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${models.length} models`} aria-label="Search generation models" />
    <div className="flex gap-2">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="min-w-0 flex-1" aria-label="Generation model"><SelectValue placeholder="Select a model" /></SelectTrigger>
        <SelectContent>{visible.map((model) => <SelectItem key={model.id} value={model.id}>
          {favorites.has(model.id) ? "★ " : ""}{model.label}{model.premium ? " (premium)" : ""}
        </SelectItem>)}</SelectContent>
      </Select>
      <Button type="button" variant="outline" size="icon" disabled={!value} aria-label={favorites.has(value) ? "Remove model from favorites" : "Favorite this model"} aria-pressed={favorites.has(value)} onClick={() => toggle(value)}>
        <Star className="h-4 w-4" fill={favorites.has(value) ? "currentColor" : "none"} />
      </Button>
    </div>
    <Button type="button" size="sm" variant={favoritesOnly ? "secondary" : "ghost"} aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly((previous) => !previous)}>Favorites only</Button>
    {!matches.length && <p className="text-xs text-muted-foreground">No matches. Your current model remains selectable.</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
