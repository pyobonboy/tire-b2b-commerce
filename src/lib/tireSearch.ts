export interface ParsedTireSize {
  width: number;
  ratio: number;
  rim: number;
}

function isValidSize({ width, ratio, rim }: ParsedTireSize) {
  return width >= 100 && width <= 400 && ratio >= 20 && ratio <= 100 && rim >= 10 && rim <= 30;
}

export function parseTireSize(value: string): ParsedTireSize | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const groups = trimmed.match(/\d+/g) ?? [];
  let parsed: ParsedTireSize | null = null;

  if (groups.length >= 3) {
    parsed = {
      width: Number(groups[0]),
      ratio: Number(groups[1]),
      rim: Number(groups[2]),
    };
  } else {
    const compact = trimmed.replace(/\D/g, "");
    if (compact.length === 7) {
      parsed = {
        width: Number(compact.slice(0, 3)),
        ratio: Number(compact.slice(3, 5)),
        rim: Number(compact.slice(5, 7)),
      };
    }
  }

  return parsed && isValidSize(parsed) ? parsed : null;
}

export function formatTireSize(size: ParsedTireSize) {
  return `${size.width} ${size.ratio} ${size.rim}`;
}
