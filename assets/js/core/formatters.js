export const euro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export const decimalInput = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: "always",
});

export const euroCents = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: "always",
});

export function parseItalianAmount(raw) {
  const text = String(raw ?? "").trim();
  if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(text)) return null;
  const amount = Number(text.replaceAll(".", "").replace(",", "."));
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) ? cents / 100 : null;
}

export const months = [
  "Gen",
  "Feb",
  "Mar",
  "Apr",
  "Mag",
  "Giu",
  "Lug",
  "Ago",
  "Set",
  "Ott",
  "Nov",
  "Dic",
];

export const clone = (value) => JSON.parse(JSON.stringify(value));

export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character],
  );
}

export function statusClass(status) {
  if (status === "Attivo") return "active";
  if (status === "Disattivo") return "inactive";
  if (["Completato", "Approvato", "Approvata"].includes(status))
    return "approved";
  if (status === "Creato") return "created";
  if (String(status).includes("approvazione")) return "pending";
  if (status === "Respinta") return "rejected";
  return "draft";
}

export function normalizeCode(value) {
  return String(value || "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}
