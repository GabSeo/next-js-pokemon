"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "cardtrace:collection";
const CHANGE_EVENT = "cardtrace:collection-changed";

function readCollection(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeCollection(ids: string[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

export function AddToCollectionButton({ cardId }: { cardId: string }) {
  const inCollection = useSyncExternalStore(
    subscribe,
    () => readCollection().includes(cardId),
    () => false
  );

  function toggle() {
    const current = readCollection();
    const next = current.includes(cardId)
      ? current.filter((id) => id !== cardId)
      : [...current, cardId];
    writeCollection(next);
  }

  return (
    <Button type="button" variant={inCollection ? "secondary" : "outline"} onClick={toggle}>
      {inCollection ? "In your collection ✓" : "Add to my collection"}
    </Button>
  );
}
