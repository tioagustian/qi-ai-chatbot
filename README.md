# Qi AI WhatsApp Chatbot

Qi adalah AI chatbot untuk WhatsApp yang dapat berinteraksi dalam grup dengan memahami konteks percakapan, memiliki kepribadian yang berkembang, dan dapat dikonfigurasi tanpa harus me-restart program.

## Fitur

- 💬 Berinteraksi di grup WhatsApp dengan natural
- 🧠 Memahami konteks percakapan dan topik yang sedang dibahas
- 😄 Memiliki mood dan kepribadian yang berubah seiring waktu
- 🤖 Mendukung multiple AI providers (OpenRouter, Google Gemini, Together.AI)
- ⚙️ Konfigurasi dapat diubah melalui chat tanpa restart program
- 🔄 Cerdas memutuskan kapan harus merespon atau diam dalam percakapan
- 🇮🇩 Menggunakan gaya bahasa anak muda Indonesia
- 🛠️ Mendukung fungsi tools pada model AI yang kompatibel
- 👥 Dapat membedakan chat grup dan pribadi serta interaksi yang sesuai
- 🔍 Mengenali anggota grup dan riwayat interaksi dengan mereka
- 🌐 Dapat membawa konteks percakapan pribadi ke dalam grup jika relevan
- 👋 Memperkenalkan diri secara otomatis saat masuk grup baru
- 🧩 Mendukung analisis gambar dan konteks visual
- 📝 Memori yang ditingkatkan untuk percakapan yang lebih kontekstual

## Prasyarat

- Node.js v18+
- API key dari salah satu provider:
  - OpenRouter (https://openrouter.ai)
  - Google Gemini API (https://ai.google.dev/)
  - Together.AI (https://together.ai)
- WhatsApp yang terhubung dengan internet

## Instalasi

1. Clone repositori ini:
```bash
git clone https://github.com/yourusername/qi-ai-chatbot.git
cd qi-ai-chatbot
```

2. Install dependencies:
```bash
npm install
```

3. Buat file `.env` dengan isi:
```
# OpenRouter API Configuration
OPENROUTER_API_KEY=your_openrouter_api_key
GEMINI_API_KEY=your_gemini_api_key
TOGETHER_API_KEY=your_together_api_key

# Model Configuration
DEFAULT_MODEL=anthropic/claude-3-opus-20240229
GEMINI_MODEL=google/gemini-1.5-pro
TOGETHER_MODEL=meta-llama/Llama-3.3-70B-Instruct-Turbo-Free
DEFAULT_PROVIDER=openrouter

# WhatsApp Session
SESSION_NAME=qi-ai-session
BOT_ID=your_bot_phone_number

# Bot Configuration
BOT_NAME=Qi
LANGUAGE=id
MOOD_CHANGE_PROBABILITY=0.15
DEFAULT_MOOD=happy
DEFAULT_PERSONALITY=friendly

# Memory and Context Settings
MAX_CONTEXT_MESSAGES=100
MAX_RELEVANT_MESSAGES=20
MAX_CROSS_CHAT_MESSAGES=8
MAX_PARTICIPANTS_INTRO=10
MAX_IMAGE_ANALYSIS_MESSAGES=3
MAX_TOPIC_SPECIFIC_MESSAGES=10
ENHANCED_MEMORY_ENABLED=true

# Logging and Debug
DEBUG=true
```

4. Jalankan bot:
```bash
npm start
```

5. Scan QR code yang muncul di terminal dengan WhatsApp di ponsel Anda.

## Penggunaan

Bot akan otomatis merespon pesan di grup WhatsApp sesuai dengan konteks percakapan. Bot akan memilih apakah akan merespon atau diam, kecuali jika secara eksplisit di-tag atau di-mention.

Beberapa perintah yang tersedia:

- `!help` - Menampilkan daftar perintah
- `!ping` - Mengecek apakah bot aktif
- `!status` - Menampilkan status bot saat ini
- `!setmood [mood]` - Mengubah mood bot
- `!setpersonality [personality]` - Mengubah kepribadian bot
- `!clear` - Menghapus konteks percakapan
- `!setmodel [model_id]` - Mengubah model AI yang digunakan
- `!setprovider [provider]` - Mengubah provider AI (openrouter/gemini/together)
- `!setapikey [api_key]` - Mengatur API key OpenRouter
- `!setgeminikey [api_key]` - Mengatur API key Google Gemini
- `!settogetherkey [api_key]` - Mengatur API key Together.AI
- `!setname [nama]` - Mengubah nama bot
- `!debug` - Menampilkan informasi debug
- `!setcharacter [deskripsi]` - Mengatur pengetahuan karakter bot

## Fitur Sosial

Bot ini memiliki kemampuan sosial yang ditingkatkan:

### Pengenalan Anggota Grup
Bot mengenali anggota dalam grup dan akan menyapa mereka dengan nama. Bot juga dapat memperkenalkan diri secara otomatis saat pertama kali bergabung dengan grup baru atau setelah tidak aktif dalam waktu lama.

### Perbedaan Chat Pribadi vs Grup
Bot memiliki perilaku yang berbeda di chat pribadi dan grup:
- Di chat pribadi: Bot hampir selalu merespon pesan
- Di chat grup: Bot lebih selektif, merespon hanya ketika ditag atau saat merasa pesan tersebut perlu direspon

### Cross-Chat Context
Bot dapat mengingat percakapan dari chat pribadi dan menggunakan informasi tersebut dalam percakapan grup saat relevan. Ini membuat interaksi lebih personal dan kontekstual.

### Memori Partisipan
Bot menyimpan informasi tentang semua orang yang berinteraksi dengannya, termasuk:
- Jumlah pesan yang telah dikirim
- Grup yang diikuti bersama
- Interaksi terakhir
- Preferensi yang terlihat dari riwayat percakapan

### Analisis Gambar
Bot dapat menganalisis gambar yang dikirim dalam chat dan memberikan respons yang kontekstual berdasarkan konten visual.

## Model AI dan Tool Support

Bot mendukung berbagai model AI melalui OpenRouter, Google Gemini, dan Together.AI. Beberapa model mendukung penggunaan tools (fungsi) seperti mendapatkan waktu saat ini.

### Model dengan Shortname

Anda dapat menggunakan shortname untuk memudahkan pengaturan model:

#### OpenRouter Models:

| Shortname | Model Lengkap | Tool Support |
|-----------|---------------|-------------|
| gpt4o | openai/gpt-4o | ✅ |
| gpt4 | openai/gpt-4 | ✅ |
| gpt3 | openai/gpt-3.5-turbo | ✅ |
| claude3opus | anthropic/claude-3-opus | ✅ |
| claude3sonnet | anthropic/claude-3-sonnet | ✅ |
| claude3haiku | anthropic/claude-3-haiku | ✅ |
| deepseek | deepseek/deepseek-chat-v3-0324:free | ❌ |
| mistral | mistralai/mistral-7b-instruct | ❌ |
| llama3 | meta-llama/llama-3-8b-instruct | ❌ |

#### Google Gemini Models:

| Shortname | Model Lengkap | Tool Support |
|-----------|---------------|-------------|
| gemini15pro | google/gemini-1.5-pro | ✅ |
| gemini15flash | google/gemini-1.5-flash | ✅ |
| gemini10pro | google/gemini-1.0-pro | ❌ |

#### Together.AI Models:

| Shortname | Model Lengkap | Tool Support |
|-----------|---------------|-------------|
| llama370b | meta-llama/Llama-3.3-70B-Instruct-Turbo-Free | ❌ |

Untuk mengubah model, gunakan:
```
!setmodel [shortname]
```

Untuk mengubah provider, gunakan:
```
!setprovider [openrouter/gemini/together]
```

Catatan:
- Model OpenRouter memerlukan OpenRouter API key (`!setapikey`)
- Model Gemini memerlukan Google Gemini API key (`!setgeminikey`)
- Model Together.AI memerlukan Together.AI API key (`!settogetherkey`)

## Debugging

Untuk mengaktifkan log debug, pastikan `DEBUG=true` di file `.env`. Log akan menampilkan informasi detail tentang:
- Permintaan API dan respons
- Alur eksekusi
- Status memori dan konteks
- Informasi grup dan partisipan
- Analisis gambar
- Perubahan mood dan kepribadian

## Mood dan Kepribadian

Bot memiliki beberapa mood yang dapat berubah secara otomatis atau diubah manual:
- `happy` - Ceria dan antusias
- `sad` - Sedih dan kurang bersemangat
- `excited` - Sangat bersemangat dan enerjik
- `bored` - Bosan dan kurang tertarik
- `curious` - Penasaran dan ingin tahu
- `annoyed` - Agak kesal
- `sleepy` - Mengantuk dan lambat merespon
- `energetic` - Penuh energi

Bot juga memiliki beberapa kepribadian:
- `friendly` - Ramah dan menyenangkan
- `sassy` - Kritis dan suka melempar candaan
- `shy` - Pemalu dan tidak banyak bicara
- `confident` - Percaya diri dan tegas
- `helpful` - Selalu ingin membantu
- `sarcastic` - Suka menggunakan sarkasme
- `chill` - Santai dan tenang
- `dramatic` - Ekspresif dan dramatis

## Lisensi

MIT 