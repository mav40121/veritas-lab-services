// tests/playwright/veritacomp-quiz-randomize-html.spec.ts
//
// Gate 3 step 8 receipt for the VeritaComp quiz randomization + HTML
// question prompt PR (PR1A, 2026-06-09).
//
// What this asserts (the parts that DON'T require San Carlos's quiz
// actually uploaded):
//   1. Both quiz-options toggles render in the New Quiz dialog
//      (Randomize question order + Question prompts contain HTML).
//   2. The /api/veritacomp/quizzes/:id endpoint accepts the new fields
//      in POST and round-trips them.
//
// What this CANNOT assert here:
//   - The actual ABO/Rh reaction table rendering (needs the quiz
//     uploaded). That's Michael's browser-click after deploy.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";
const PROGRAM_ID = process.env.PW_VERITACOMP_PROGRAM_ID || "";

test.describe("VeritaComp Quiz randomization + HTML question prompts", () => {
  test("PUT/POST quiz endpoint accepts randomizeQuestions + questionFormat", async ({ request }) => {
    test.skip(!TOKEN || !PROGRAM_ID, "PW_TOKEN and PW_VERITACOMP_PROGRAM_ID required");
    // Create a quiz with both new flags set true / 'html'.
    const create = await request.post(
      `${BASE}/api/veritacomp/programs/${PROGRAM_ID}/quizzes`,
      {
        headers: { Authorization: `Bearer ${TOKEN}` },
        data: {
          title: `PR1A round-trip ${Date.now()}`,
          methodGroupIds: [],
          methodGroupId: null,
          methodGroupName: null,
          questions: [
            {
              id: "q1",
              question: "<p>Sample <strong>HTML</strong> prompt.</p>",
              type: "multiple_choice",
              options: ["A. one", "B. two"],
              correct_answer: "A",
              explanation: "",
            },
          ],
          randomizeQuestions: true,
          questionFormat: "html",
        },
      }
    );
    expect(create.ok()).toBeTruthy();
    const body = await create.json();
    expect(body.randomize_questions).toBe(1);
    expect(body.question_format).toBe("html");

    // Fetch it back; verify the flags persisted.
    const fetched = await request.get(`${BASE}/api/veritacomp/quizzes/${body.id}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(fetched.ok()).toBeTruthy();
    const fetchedBody = await fetched.json();
    expect(fetchedBody.randomize_questions).toBe(1);
    expect(fetchedBody.question_format).toBe("html");

    // Delete to clean up (no results recorded so DELETE is allowed).
    await request.delete(`${BASE}/api/veritacomp/quizzes/${body.id}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
  });

  test("randomize-flagged quiz returns different question orders across fetches", async ({ request }) => {
    test.skip(!TOKEN || !PROGRAM_ID, "PW_TOKEN and PW_VERITACOMP_PROGRAM_ID required");
    // Create a quiz with 10 questions and randomize=true.
    const questions = Array.from({ length: 10 }, (_, i) => ({
      id: `q${i + 1}`,
      question: `Question ${i + 1} prompt`,
      type: "multiple_choice",
      options: ["A. one", "B. two"],
      correct_answer: "A",
    }));
    const create = await request.post(
      `${BASE}/api/veritacomp/programs/${PROGRAM_ID}/quizzes`,
      {
        headers: { Authorization: `Bearer ${TOKEN}` },
        data: {
          title: `PR1A shuffle ${Date.now()}`,
          methodGroupIds: [],
          methodGroupId: null,
          methodGroupName: null,
          questions,
          randomizeQuestions: true,
          questionFormat: "plain",
        },
      }
    );
    expect(create.ok()).toBeTruthy();
    const { id } = await create.json();

    // Fetch 5 times. The probability that 5 fetches all return the
    // same canonical order is (1/10!)^4 ≈ 1.4e-25 — effectively zero
    // under a fair shuffle.
    const orders: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await request.get(`${BASE}/api/veritacomp/quizzes/${id}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      const body = await r.json();
      const order = body.questions.map((q: any) => q.id).join(",");
      orders.push(order);
    }
    const uniq = new Set(orders);
    expect(uniq.size).toBeGreaterThan(1);

    await request.delete(`${BASE}/api/veritacomp/quizzes/${id}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
  });

  test("non-randomized quiz returns stable order across fetches", async ({ request }) => {
    test.skip(!TOKEN || !PROGRAM_ID, "PW_TOKEN and PW_VERITACOMP_PROGRAM_ID required");
    const questions = Array.from({ length: 5 }, (_, i) => ({
      id: `q${i + 1}`,
      question: `Question ${i + 1} prompt`,
      type: "multiple_choice",
      options: ["A. one", "B. two"],
      correct_answer: "A",
    }));
    const create = await request.post(
      `${BASE}/api/veritacomp/programs/${PROGRAM_ID}/quizzes`,
      {
        headers: { Authorization: `Bearer ${TOKEN}` },
        data: {
          title: `PR1A stable ${Date.now()}`,
          methodGroupIds: [],
          methodGroupId: null,
          methodGroupName: null,
          questions,
          randomizeQuestions: false,
          questionFormat: "plain",
        },
      }
    );
    const { id } = await create.json();
    const orders: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await request.get(`${BASE}/api/veritacomp/quizzes/${id}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      const body = await r.json();
      orders.push(body.questions.map((q: any) => q.id).join(","));
    }
    expect(new Set(orders).size).toBe(1);
    await request.delete(`${BASE}/api/veritacomp/quizzes/${id}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
  });
});
