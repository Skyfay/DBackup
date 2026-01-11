"use client"

import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Monitor, Moon, Sun } from "lucide-react"
import { useEffect, useState } from "react"

export function AppearanceForm() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Appearance</CardTitle>
                <CardDescription>
                    Customize the look and feel of the application. Automatically switches between day and night themes.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex items-center space-x-4">
                    <div className="h-24 w-40 rounded-md bg-muted animate-pulse" />
                    <div className="h-24 w-40 rounded-md bg-muted animate-pulse" />
                    <div className="h-24 w-40 rounded-md bg-muted animate-pulse" />
                </div>
            </CardContent>
        </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>
          Customize the look and feel of the application. Automatically switches between day and night themes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-2">
                <Button
                    variant="outline"
                    className={`h-24 w-40 flex flex-col items-center justify-center gap-2 ${theme === 'light' ? 'border-2 border-primary' : ''}`}
                    onClick={() => setTheme("light")}
                >
                    <Sun className="h-6 w-6" />
                    <span className="font-medium">Light</span>
                </Button>
            </div>
            <div className="flex flex-col gap-2">
                <Button
                    variant="outline"
                    className={`h-24 w-40 flex flex-col items-center justify-center gap-2 ${theme === 'dark' ? 'border-2 border-primary' : ''}`}
                    onClick={() => setTheme("dark")}
                >
                    <Moon className="h-6 w-6" />
                    <span className="font-medium">Dark</span>
                </Button>
            </div>
            <div className="flex flex-col gap-2">
                <Button
                    variant="outline"
                    className={`h-24 w-40 flex flex-col items-center justify-center gap-2 ${theme === 'system' ? 'border-2 border-primary' : ''}`}
                    onClick={() => setTheme("system")}
                >
                    <Monitor className="h-6 w-6" />
                    <span className="font-medium">System</span>
                </Button>
            </div>
        </div>
      </CardContent>
    </Card>
  )
}
