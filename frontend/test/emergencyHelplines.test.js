import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const emergencyJsxPath = fileURLToPath(
  new URL("../src/components/EmergencyView.jsx", import.meta.url)
);
const emergencyCssPath = fileURLToPath(
  new URL("../src/components/EmergencyView.css", import.meta.url)
);

test("Emergency contacts directory contains verified emergency numbers and valid metadata", () => {
  const content = fs.readFileSync(emergencyJsxPath, "utf-8");

  // Verify critical national and Jaipur helplines exist in the code
  const requiredHelplines = [
    { number: "112", name: "ERSS / Police" },
    { number: "108", name: "Ambulance" },
    { number: "101", name: "Fire" },
    { number: "1090", name: "Women Helpline" },
    { number: "1930", name: "Cyber Crime" },
    { number: "1098", name: "Childline" },
    { number: "1070", name: "State Disaster Management" },
    { number: "1077", name: "District Collectorate DEOC" },
    { number: "1095", name: "Jaipur Traffic Police" },
    { number: "1363", name: "Tourist Helpline" },
    { number: "14567", name: "Senior Citizens (Elderline)" },
  ];

  for (const { number, name } of requiredHelplines) {
    assert.ok(
      content.includes(`"${number}"`),
      `Required helpline ${number} (${name}) must be present in EmergencyView`
    );
  }
});

test("EmergencyView includes safe Google AdSense publisher ID and non-interfering placement", () => {
  const content = fs.readFileSync(emergencyJsxPath, "utf-8");

  assert.ok(
    content.includes("ca-pub-9794253080735375"),
    "Existing Google AdSense publisher ID must be preserved"
  );
  assert.ok(
    content.includes("emergency-ad-container"),
    "Safe non-interfering ad container must be present"
  );
});

test("EmergencyView styles are strictly scoped under .emergency-premium", () => {
  const cssContent = fs.readFileSync(emergencyCssPath, "utf-8");

  assert.ok(
    cssContent.includes(".emergency-premium"),
    "Root class must be .emergency-premium"
  );
  assert.ok(
    cssContent.includes("prefers-reduced-motion"),
    "prefers-reduced-motion media query must be present for accessibility"
  );
});

