import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tanstackStart(), react(), tailwindcss()],
	resolve: {
		tsconfigPaths: true,
	},
});
