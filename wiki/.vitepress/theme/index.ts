// https://vitepress.dev/guide/custom-theme
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import { watch } from 'vue'
import { enhanceAppWithTabs } from 'vitepress-plugin-tabs/client'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }: { app: any }) {
    enhanceAppWithTabs(app)
  },
  setup() {
    // Override date formatting to use European format (DD.MM.YYYY)
    const { page } = useData()

    // Watch for page changes and reformat the date display
    if (typeof window !== 'undefined') {
      watch(() => page.value.lastUpdated, (timestamp) => {
        if (!timestamp) return

        // Wait for DOM to update
        setTimeout(() => {
          const lastUpdatedEl = document.querySelector('.VPLastUpdated time')
          if (lastUpdatedEl && timestamp) {
            const date = new Date(timestamp)
            // Format: DD.MM.YYYY, HH:MM (Swiss/German format)
            const formatted = date.toLocaleString('de-CH', {
              dateStyle: 'short',
              timeStyle: 'short'
            })
            lastUpdatedEl.textContent = formatted
          }
        }, 0)
      }, { immediate: true })
    }
  }
}