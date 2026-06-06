export function cleanEnvValue(value: string | undefined) {
  return value?.replace(/^\uFEFF/, '').trim()
}
