import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tanstackStart(), nitro(), react(), tailwindcss()],
	resolve: {
		tsconfigPaths: true,
	},
});
