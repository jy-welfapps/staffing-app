# セットアップ手順（初回1回だけ）

## 1. このフォルダの中身をGitHubリポジトリに置く

```
リポジトリ/
├── .github/
│   └── workflows/
│       └── deploy.yml
├── src/
│   ├── main.jsx
│   └── App.jsx        ← スケジューラ本体
├── index.html
├── package.json
├── vite.config.js
└── .gitignore
```

## 2. vite.config.js を編集する

```js
base: '/YOUR_REPO_NAME/',  // ← リポジトリ名に変更
```

例: `https://github.com/yamada/childcare-app` なら
```js
base: '/childcare-app/',
```

## 3. GitHub Pages の設定を変更する

1. リポジトリの「Settings」→「Pages」を開く
2. **Source** を `GitHub Actions` に変更して保存

## 4. pushする

```bash
git add .
git commit -m "初期セットアップ"
git push origin main
```

## 5. 完了！

数分後に `https://ユーザー名.github.io/リポジトリ名/` で公開されます。

## 次回以降の更新方法

App.jsx を更新したら：
```bash
git add src/App.jsx
git commit -m "更新内容のメモ"
git push origin main
```

**これだけ**でGitHub Actionsが自動でビルド＆デプロイします。
