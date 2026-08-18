import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lighthouse",
    short_name: "Lighthouse",
    description: "Your private harbour: money, goals, documents, and a bit of light.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1220",
    theme_color: "#0b1220",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Android/desktop share sheet → straight into document ingest.
    // (iOS ignores share_target; the camera/file picker covers it there.)
    share_target: {
      action: "/api/documents/ingest",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        files: [{ name: "files", accept: ["application/pdf", "image/*"] }],
      },
    },
  } as MetadataRoute.Manifest;
}
