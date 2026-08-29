# Prompt video background HYDRA

Gunakan prompt berikut di Gemini Omni atau model video Gemini yang tersedia:

```text
Create an 8-second seamless cinematic background loop for a premium bright IoT hydroponics monitoring dashboard.

Scene: inside a modern NFT hydroponic greenhouse in the early morning. Long rows of healthy lettuce and leafy greens grow from clean white cultivation channels. Small industrial IoT sensors, water tubes, a reservoir line, and environmental probes are visible but subtle and realistic. Soft daylight passes through the translucent greenhouse roof. The plants move only slightly from gentle ventilation.

Camera: locked wide camera with an extremely slow, smooth forward dolly of only a few centimeters. No cuts, no sudden motion, no rack focus, no handheld movement. Preserve large calm areas and clean geometry so dashboard typography remains readable over the left half of the frame.

Composition: 16:9 horizontal frame. Keep the brightest greenhouse structure and most detailed plants on the right side. Keep the left side softer, brighter, lower contrast, and visually quiet for dark green interface text. Natural perspective, premium architectural photography.

Color direction: mineral white, chlorophyll green, soft sage, and a very small amount of pale aqua. Bright and fresh, not oversaturated. Calm, precise, credible agricultural technology.

Loop requirement: the first and last frames must match perfectly. The plant movement, ventilation, daylight, and camera position must return naturally to the opening state. The loop must be invisible when repeated.

Output: 1920x1080, 24 fps, MP4 H.264, 8 seconds, photorealistic, high detail.

Avoid: people, hands, faces, logos, labels, text, watermark, screens with UI, dark cyberpunk lighting, blue neon, purple gradients, fog, dramatic camera moves, time-lapse growth, flicker, unstable geometry, morphing plants, extra limbs, fantasy agriculture, laboratory stock-photo posing.
```

## Integrasi ke frontend

1. Simpan hasil sebagai `public/media/hydra-greenhouse-loop.mp4`.
2. Isi `VITE_HERO_VIDEO_URL=/media/hydra-greenhouse-loop.mp4` pada `.env` frontend.
3. Jalankan ulang Vite. Foto WebP yang ada tetap menjadi poster dan fallback jika video gagal dimuat.
