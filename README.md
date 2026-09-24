# Sentinel PWA — Deploy no GitHub Pages

## Estrutura de arquivos

```
sentinel-pwa/
├── index.html          ← app principal
├── manifest.json       ← config do PWA
├── sw.js               ← service worker (offline)
├── generate-icons.html ← gera os ícones (abre no navegador)
└── icons/
    ├── icon-192.png    ← ícone (gerar com generate-icons.html)
    └── icon-512.png    ← ícone grande
```

---

## Passo 1 — Gerar os ícones

1. Abra `generate-icons.html` no navegador
2. Clique em **Baixar icon-192.png**
3. Clique em **Baixar icon-512.png**
4. Mova os dois arquivos para a pasta `icons/`

---

## Passo 2 — Criar repositório no GitHub

1. Acesse https://github.com/new
2. Nome do repositório: `sentinel` (ou qualquer nome)
3. Marque **Public**
4. Clique em **Create repository**

---

## Passo 3 — Enviar os arquivos

### Opção A — Pelo site (mais fácil)

1. Dentro do repositório criado, clique em **Add file → Upload files**
2. Arraste todos os arquivos da pasta `sentinel-pwa/`
3. Certifique-se de criar a pasta `icons/` com os dois PNGs
4. Clique em **Commit changes**

### Opção B — Pelo terminal

```bash
cd sentinel-pwa
git init
git add .
git commit -m "Sentinel PWA"
git remote add origin https://github.com/SEU_USUARIO/sentinel.git
git push -u origin main
```

---

## Passo 4 — Ativar o GitHub Pages

1. No repositório, clique em **Settings**
2. No menu lateral, clique em **Pages**
3. Em **Source**, selecione **Deploy from a branch**
4. Em **Branch**, selecione **main** e pasta **/ (root)**
5. Clique em **Save**

Após ~1 minuto, o app estará disponível em:

```
https://SEU_USUARIO.github.io/sentinel/
```

---

## Passo 5 — Instalar no celular

### Android (Chrome)
1. Abra o link no Chrome
2. Um banner **"Adicionar à tela inicial"** aparece automaticamente
3. Ou toque nos 3 pontos → **Adicionar à tela inicial**

### iPhone (Safari)
1. Abra o link no **Safari** (obrigatório, não Chrome)
2. Toque no botão de compartilhar (quadrado com seta)
3. Role e toque em **Adicionar à Tela de Início**

---

## Permissões (uma única vez)

Na primeira vez que abrir o app, ele pede:
- **Localização** → autorize para GPS
- **Câmera** → autorize para câmera de segurança

O sistema operacional memoriza essa escolha.
Nas próximas vezes, o app abre direto.

---

## Funcionalidades

| Função | Android | iPhone |
|---|---|---|
| Instalar como app | ✅ | ✅ |
| GPS em tempo real | ✅ | ✅ |
| Câmera ao vivo | ✅ | ✅ |
| Histórico offline | ✅ | ✅ |
| Exportar CSV | ✅ | ✅ |
| Funciona sem internet | ✅ | ✅ |

---

## Atualizar o app

Para atualizar: edite os arquivos, commit e push.
O service worker detecta a nova versão automaticamente.
