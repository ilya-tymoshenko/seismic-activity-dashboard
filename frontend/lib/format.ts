export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits
  });
}

export function formatInteger(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "0";
  }
  return value.toLocaleString();
}

export function formatDateTime(value?: string | null): string {
  if (!value) {
    return "n/a";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function magnitudeTone(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "#8b97a6";
  }
  if (value >= 7) {
    return "#b91c1c";
  }
  if (value >= 5) {
    return "#e15b42";
  }
  if (value >= 3) {
    return "#f3a712";
  }
  return "#2ca58d";
}
