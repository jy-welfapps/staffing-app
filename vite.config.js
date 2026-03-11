import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // ★ ここを自分のGitHubリポジトリ名に変更してください
  // 例: リポジトリが https://github.com/yourname/childcare なら '/childcare/'
  base: '/staffing-app/',
})
