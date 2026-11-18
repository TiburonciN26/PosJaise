// Atributos para que un campo de texto NO muestre la barra de sugerencias del teclado (autocompletar de tarjetas,
// direcciones, contraseñas y predicción de palabras). Convención de los formularios de catálogo: se esparce en cada
// <input>/<textarea> (`{...SIN_SUGERENCIAS}`) para que un campo nuevo no pueda olvidarse de la regla.
export const SIN_SUGERENCIAS = {
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'off',
  spellCheck: false,
  'data-lpignore': 'true', // LastPass
  'data-1p-ignore': 'true', // 1Password
  'data-form-type': 'other', // Dashlane
}
