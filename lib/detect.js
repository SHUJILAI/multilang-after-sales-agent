// 语言识别：无需任何依赖，基于 Unicode 区间 + 高频词打分
function detectLang(text) {
  if (/[\u0E00-\u0E7F]/.test(text)) return "th"; // 泰文
  if (/[\u0400-\u04FF]/.test(text)) return "ru"; // 西里尔
  if (/[\u4e00-\u9fa5]/.test(text)) return "zh"; // 汉字
  if (/[\u0600-\u06FF]/.test(text)) return "ar"; // 阿拉伯
  if (/[\u3040-\u30ff]/.test(text)) return "ja"; // 日文假名
  if (/[\uac00-\ud7af]/.test(text)) return "ko"; // 韩文
  const low = " " + text.toLowerCase() + " ";
  const esW = [" el "," la "," los "," las "," de "," que "," con "," una "," para "," sin "," por "," mi "," su "," está"," esta "," tiene"," máquina"," maquina"," láser"," corte"," agua"," presión"," presion"," error"," falla"," lente"," quema"," laser"," emite"," nada"," hace "," favor"," gracias"," cómo"," como "," no corta"," muestra"," hago","¿"];
  const enW = [" the "," is "," machine"," laser"," cut"," water"," error"," how"," what"," not "," pressure"," no "," my "," i "];
  let es = 0, en = 0;
  esW.forEach(w => { if (low.includes(w)) es++; });
  enW.forEach(w => { if (low.includes(w)) en++; });
  return es > en ? "es" : "en";
}

const LANG_NAME = {
  zh: "中文", en: "English", es: "Español", ru: "Русский",
  th: "ไทย", ar: "العربية", ja: "日本語", ko: "한국어"
};

module.exports = { detectLang, LANG_NAME };
