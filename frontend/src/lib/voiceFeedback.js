// Arabic feedback messages for Web Speech API errors
export function getVoiceFeedbackMessage(errorCode) {
  switch (errorCode) {
    case "no-speech":
      return "لم أسمع أي صوت. حاول مرة أخرى";
    case "aborted":
      return "تم إلغاء الاستماع";
    case "audio-capture":
      return "تعذّر الوصول إلى المايكروفون";
    case "network":
      return "خطأ في الشبكة. تحقّق من الاتصال";
    case "not-allowed":
    case "service-not-allowed":
      return "الرجاء السماح بإذن المايكروفون";
    case "bad-grammar":
      return "خطأ في قواعد التعرّف على الصوت";
    case "language-not-supported":
      return "اللغة غير مدعومة";
    default:
      return "لم أتمكن من فهم الصوت. حاول مرة أخرى";
  }
}
