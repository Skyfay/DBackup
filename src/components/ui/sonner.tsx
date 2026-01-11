"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      toastOptions={{
        classNames: {
          toast: "border bg-background text-foreground",
          title: "text-foreground",
          description: "text-muted-foreground",
        },
      }}
    />
  );
}
