# 🔄 Google Search Site Switch

[![Install](https://img.shields.io/badge/Install-Script-blue.svg)](https://raw.githubusercontent.com/yookibooki/userscripts/refs/heads/main/google-search-site-switch/user.js)
[![License](https://img.shields.io/github/license/yookibooki/userscripts)](../LICENSE)

## 📝 Description
Adds search engines to Google's results page

![Demo](https://i.imgur.com/HendpOp.png)

## 🔧 Installation
1. Install a userscript manager (e.g. [Violentmonkey](https://violentmonkey.github.io))
2. Click the "Install from Greasy Fork" button above

## ⚙️ Customization
Customize which search engines appears by:

```javascript
const engines = [
  ['Yandex', 'yandex.com', `https://yandex.com/search/?text=${query}`],
  ['Bing', 'bing.com', `https://www.bing.com/search?q=${query}`],
  // Add more engines here
];
```
