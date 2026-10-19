// The 16 dye colours: wool colours (block meta), their wool items and dyes.
export const COLORS = [
  ['white', 'White', [233, 236, 236]], ['orange', 'Orange', [240, 118, 19]], ['magenta', 'Magenta', [189, 68, 179]],
  ['light_blue', 'Light Blue', [58, 175, 217]], ['yellow', 'Yellow', [248, 198, 39]], ['lime', 'Lime', [112, 185, 25]],
  ['pink', 'Pink', [237, 141, 172]], ['gray', 'Gray', [62, 68, 71]], ['light_gray', 'Light Gray', [142, 142, 134]],
  ['cyan', 'Cyan', [21, 137, 145]], ['purple', 'Purple', [121, 42, 172]], ['blue', 'Blue', [53, 57, 157]],
  ['brown', 'Brown', [114, 71, 40]], ['green', 'Green', [84, 109, 27]], ['red', 'Red', [161, 39, 34]], ['black', 'Black', [20, 21, 25]],
];
export const COLOR = Object.fromEntries(COLORS.map(([k], i) => [k.toUpperCase(), i]));

/** Wool tint per colour (multiplied with the grey-white wool texture). */
export const WOOL_RGB = COLORS.map(([, , rgb]) => rgb.map((v) => Math.min(255, Math.round(v * 1.08))));

/** Natural sheep colours (reference odds): white 81.836 %, black/gray/light gray 5 % each, brown 3 %, pink 0.164 %. */
export function randomSheepColor(rng = Math.random) {
  const r = rng() * 100;
  if (r < 5) return COLOR.BLACK;
  if (r < 10) return COLOR.GRAY;
  if (r < 15) return COLOR.LIGHT_GRAY;
  if (r < 18) return COLOR.BROWN;
  if (r < 18.164) return COLOR.PINK;
  return COLOR.WHITE;
}
