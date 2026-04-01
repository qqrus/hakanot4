import { DEFAULT_FILE_NAME, DEFAULT_LANGUAGE, DEMO_ROOM_ID } from "@collabcode/shared";

export const sampleCode = `import statistics

def summarize(scores):
    average = sum(scores) / len(scores)
    print(f"Average: {average:.2f}")
    return {
        "average": average,
        "median": statistics.median(scores),
        "count": len(scores),
    }


if __name__ == "__main__":
    scores = [87, 91, 76, 98, 84]
    print(summarize(scores))
`;

export const demoRoom = {
  roomId: DEMO_ROOM_ID,
  name: "Demo Room",
  fileName: DEFAULT_FILE_NAME,
  language: DEFAULT_LANGUAGE,
};
