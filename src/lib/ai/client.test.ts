import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeAiProvider, aiConfigured, aiModels } from "./client";
import { checkExamPaperWithGemini } from "./tasks";
import { resetSqliteDbForTests } from "@/lib/db/sqlite";

describe("Google Gemini API client & СОР/СОЧ checker", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalAiKey = process.env.AI_API_KEY;
  const originalProvider = process.env.AI_PROVIDER;

  beforeEach(() => {
    process.env.DATABASE_MODE = "local";
    process.env.EDUSOR_SQLITE_PATH = ":memory:";
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "";
    process.env.AI_API_KEY = "";
    resetSqliteDbForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    if (originalAiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = originalAiKey;
    if (originalProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = originalProvider;
    resetSqliteDbForTests();
  });

  it("reports unavailable cleanly when GEMINI_API_KEY is left empty in .env", async () => {
    expect(aiConfigured()).toBe(false);
    expect(activeAiProvider()).toBe("gemini");
    expect(aiModels().provider).toBe("gemini");

    const res = await checkExamPaperWithGemini(
      {
        kind: "sor",
        title: "СОР №1",
        workText: "1) 2x = 10 => x = 5",
        locale: "ru",
      },
      { userId: null, schoolId: null },
    );

    expect(res).toEqual({ ok: false, error: "unavailable" });
  });

  it("calls Gemini generateContent endpoint with inlineData images and parses СОР/СОЧ JSON ignoring thought parts", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-api-key-placeholder";
    expect(aiConfigured()).toBe(true);

    const mockPayload = {
      extractedStudentText: "1) x = 4; 2) F = m*a = 2*3 = 6 Н",
      tasks: [
        {
          number: "1",
          promptSummary: "Уравнение",
          studentAnswer: "x = 4",
          awardedPoints: 2,
          maxPoints: 2,
          descriptors: [{ title: "Решает уравнение", awarded: 2, max: 2, comment: "Верно" }],
          feedback: "Правильно найдено значение x.",
          improvement: "",
          needsReview: false,
        },
        {
          number: "2",
          promptSummary: "Второй закон Ньютона",
          studentAnswer: "F = 6 Н",
          awardedPoints: 3,
          maxPoints: 3,
          descriptors: [{ title: "Применяет формулу F=ma", awarded: 3, max: 3, comment: "Единицы указаны" }],
          feedback: "Полный балл.",
          improvement: "",
          needsReview: false,
        },
      ],
      totalScore: 5,
      maxScore: 5,
      summaryForTeacher: "Оба задания СОР решены без ошибок.",
      feedbackForStudent: "Отличная работа! Все дескрипторы выполнены.",
      confidence: 0.96,
    };

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: "Internal reasoning part that must be skipped..." },
                  { text: JSON.stringify(mockPayload) },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 412,
            candidatesTokenCount: 230,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const res = await checkExamPaperWithGemini(
      {
        kind: "sor",
        title: "СОР по физике",
        subject: "Физика",
        grade: 7,
        rubricText: "Задание 1 (2 б.), Задание 2 (3 б.)",
        imageDataUrls: ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="],
        locale: "ru",
      },
      { userId: null, schoolId: null },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain("generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    const reqBody = JSON.parse(String(calledInit.body));
    expect(reqBody.generationConfig.responseMimeType).toBe("application/json");
    expect(reqBody.contents[0].parts.some((p: Record<string, unknown>) => "inlineData" in p)).toBe(true);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.totalScore).toBe(5);
      expect(res.data.maxScore).toBe(5);
      expect(res.data.tasks).toHaveLength(2);
      expect(res.usage).toEqual({ prompt: 412, completion: 230 });
    }
  });

  it("routes Vertex AI Express Mode keys automatically to aiplatform.googleapis.com", () => {
    process.env.GEMINI_API_KEY = ["A", "Q", ".vertex-express-placeholder"].join("");
    expect(aiModels().baseUrl).toBe("https://aiplatform.googleapis.com/v1/publishers/google");
  });
});
