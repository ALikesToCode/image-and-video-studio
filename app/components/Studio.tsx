"use client";

import { StudioProvider } from "@/app/contexts/StudioContext";
import { Dashboard } from "./Dashboard";

export default function Studio() {
  return (
    <StudioProvider>
      <Dashboard />
    </StudioProvider>
  );
}
