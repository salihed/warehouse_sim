#!/bin/bash

echo "✅ Tailwind CSS Standalone CLI kuruluyor..."

# 1. Tailwind binary indir ve çalıştırılabilir yap
curl -LO https://github.com/tailwindlabs/tailwindcss/releases/latest/download/tailwindcss-linux-x64
chmod +x tailwindcss-linux-x64
mv tailwindcss-linux-x64 tailwindcss

# 2. tailwind.config.js ve postcss.config.js oluştur
./tailwindcss init -p

# 3. index.css dosyasını Tailwind’e hazırla
cat << CSS_EOF > src/index.css
@tailwind base;
@tailwind components;
@tailwind utilities;
CSS_EOF

# 4. package.json scripts ekle
jq '.scripts["build:css"]="./tailwindcss -i ./src/index.css -o ./src/output.css --watch"' package.json > package.tmp.json
mv package.tmp.json package.json

# 5. output.css’i index.js’e import et
sed -i "1i import './output.css';" src/index.js

echo "✅ Kurulum tamamlandı!"
echo "💡 Şimdi ayrı bir terminalde 'npm run build:css' çalıştır ve sonra 'npm start'"
