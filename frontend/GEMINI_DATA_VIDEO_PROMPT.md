# Prompt video ambient section data HYDRA

Gunakan prompt berikut di Google Gemini Omni atau model video Gemini yang tersedia:

```text
Create a subtle 12-second seamless ambient background loop for the data sections of a premium bright IoT hydroponics monitoring dashboard. This video will sit behind translucent sensor cards, real-time charts, reservoir controls, actuator switches, and device diagnostics, so it must remain calm, low contrast, and easy to overlay with interface text.

Scene: a refined macro view inside a modern hydroponic system. Clear nutrient water moves slowly through a clean mineral-white NFT cultivation channel. A realistic stainless sensor probe and a small environmental cable are visible near the edge. Soft out-of-focus lettuce leaves cast gentle organic shadows across the white surface. Very subtle water reflections and pale aqua caustics move across the channel. The visual should communicate live water circulation, sensing, and plant growth without showing any interface or fake data.

Camera: completely locked camera, slightly elevated oblique angle, premium macro architectural photography. No camera travel and no cuts. Only slow water movement, extremely gentle leaf-shadow movement, and soft reflected daylight may animate.

Composition: 16:9 horizontal frame. Keep the whole frame visually quiet and evenly balanced. No strong focal point in the center. Preserve broad soft areas where white dashboard panels can remain readable. The image must work as a continuous background across a long scrolling page.

Color direction: mineral white, soft sage, chlorophyll green, pale aqua, and restrained stainless-steel gray. Bright natural greenhouse daylight. Low saturation, low contrast, clean, calm, credible, and technical.

Loop requirement: the first and last frames must match perfectly. Water reflections, leaf shadows, and every moving detail must return naturally to the opening state. The repeated loop must be impossible to notice.

Output: 1920x1080, 24 fps, MP4 H.264, 12 seconds, photorealistic, high detail, optimized for a website background.

Avoid: people, hands, faces, text, numbers, charts, dashboards, gauges, screens, logos, labels, watermark, fake telemetry, blinking indicators, dramatic bubbles, splashing water, camera movement, focus breathing, flicker, time-lapse growth, dark lighting, blue neon, purple gradients, cyberpunk styling, oversaturated plants, morphing leaves, unstable geometry, and busy high-frequency details.
```

## Integrasi ke frontend

1. Simpan hasil sebagai `public/media/hydra-data-ambient-loop.mp4`.
2. Isi `VITE_DATA_VIDEO_URL=/media/hydra-data-ambient-loop.mp4` pada `.env` frontend.
3. Jalankan ulang Vite. Video akan muncul halus di belakang section Pembacaan utama, Tren sensor, Sistem air, dan Diagnostik.
4. Jika video gagal dimuat, frontend otomatis kembali ke background terang saat ini tanpa menampilkan media rusak.
