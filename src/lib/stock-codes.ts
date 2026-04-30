// J-Quantsのコードは5桁形式 (例: "13010")。一般的な4桁コード ("1301") と相互変換する。
// 5桁の最後の "0" は将来の枝番用で、現在は基本的に "0" 固定。

export function toJQuantsCode(input: string): string {
  const digits = input.trim().replace(/\D/g, "");
  if (digits.length === 5) return digits;
  if (digits.length === 4) return `${digits}0`;
  return digits;
}

export function toShortCode(jquantsCode: string): string {
  if (jquantsCode.length === 5 && jquantsCode.endsWith("0")) {
    return jquantsCode.slice(0, 4);
  }
  return jquantsCode;
}
