// shared/quizImages.ts
//
// Pictures on VeritaComp quiz questions (Redington-Fairview REQ-074, 2026-10-14: Catherine Thornton,
// "Is there any way to import graphs and pictures for your program?"). A question may carry ONE picture
// (a graph, a smear, a screenshot) stored inside the question itself as an image data URL. Only an
// uploaded image is accepted, never a web address, so a quiz never loads anything from outside the app
// (the reason the HTML prompt sanitizer keeps <img> out). The client shrinks each picture before saving;
// the server re-checks every picture with quizImageProblem. Pictures must not show patient identifiers.

/** One picture, as a data URL: about 660 KB of image. */
export const QUIZ_IMAGE_MAX_CHARS = 900_000;
/** Every picture in one quiz together. The JSON request limit is 5 MB (server/index.ts). */
export const QUIZ_IMAGES_TOTAL_MAX_CHARS = 4_200_000;

const DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** True when the value is a picture a quiz question may show. */
export function isQuizImage(v: unknown): v is string {
  return typeof v === "string" && v.length <= QUIZ_IMAGE_MAX_CHARS && DATA_URL.test(v);
}

/**
 * Why a quiz's pictures cannot be saved, or null when they can. A question with no picture
 * (missing, null or "") is fine.
 */
export function quizImageProblem(questions: any[]): string | null {
  let total = 0;
  for (let i = 0; i < questions.length; i++) {
    const img = questions[i]?.image;
    if (img === undefined || img === null || img === "") continue;
    if (typeof img !== "string" || !img.startsWith("data:image/")) {
      return `Question ${i + 1}: the picture must be an uploaded image (PNG, JPEG, GIF or WebP), not a link`;
    }
    if (img.length > QUIZ_IMAGE_MAX_CHARS) return `Question ${i + 1}: the picture is too large; use a smaller image`;
    if (!DATA_URL.test(img)) return `Question ${i + 1}: the picture must be a PNG, JPEG, GIF or WebP image`;
    total += img.length;
  }
  if (total > QUIZ_IMAGES_TOTAL_MAX_CHARS) {
    return "This quiz has too many pictures to save together; split it into two quizzes";
  }
  return null;
}
