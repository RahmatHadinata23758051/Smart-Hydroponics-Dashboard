# Hydra Frontend

Dashboard real-time untuk sistem Smart Hydroponics Polinela.

## Menjalankan lokal

```bash
npm install
npm run dev
```

Vite berjalan di `http://localhost:5173` dan meneruskan `/api` serta `/socket.io`
ke backend pada `http://localhost:5000`.

## Build produksi

```bash
npm run build
```

Jika frontend dan backend di-deploy pada origin berbeda, salin `.env.example`
menjadi `.env` lalu atur `VITE_API_URL` ke URL backend.
