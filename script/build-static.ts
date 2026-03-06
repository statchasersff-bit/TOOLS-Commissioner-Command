import { build as viteBuild } from "vite";
import { rm } from "fs/promises";

async function buildStatic() {
  await rm("dist", { recursive: true, force: true });

  console.log("Building static frontend...");
  await viteBuild();

  console.log("Static build complete! Output in dist/public/");
  console.log("Upload the contents of dist/public/ to your web server.");
}

buildStatic().catch((err) => {
  console.error(err);
  process.exit(1);
});
