import type { Participant, SessionEvent } from "@collabcode/shared";

import { createId } from "../lib/id.js";

const RANKS = [
  "Новичок",
  "Подмастерье",
  "Программист",
  "Системный аналитик",
  "Ведущий разработчик",
  "Архитектор",
];

const XP_PER_LEVEL = 1000;

export class GamificationService {
  calculateLevel(xp: number): number {
    return Math.floor(xp / XP_PER_LEVEL) + 1;
  }

  getRank(level: number): string {
    const index = Math.min(Math.floor((level - 1) / 2), RANKS.length - 1);
    return RANKS[index] ?? "Новичок";
  }

  awardXP(participant: Participant, amount: number): {
    updatedParticipant: Participant;
    events: SessionEvent[];
  } {
    const nextXp = participant.xp + amount;
    const nextLevel = this.calculateLevel(nextXp);
    const nextRank = this.getRank(nextLevel);

    const events: SessionEvent[] = [];

    const updated: Participant = {
      ...participant,
      xp: nextXp,
      level: nextLevel,
      rank: nextRank,
    };

    if (nextLevel > participant.level) {
      events.push({
        id: createId("evt"),
        type: "rank-up",
        message: `${participant.name} повысил уровень до ${nextLevel}! Текущий ранг: ${nextRank}`,
        createdAt: new Date().toISOString(),
        participantId: participant.id,
      });
    }

    return { updatedParticipant: updated, events };
  }

  checkAchievements(participant: Participant, action: string): string[] {
    const newAchievements: string[] = [];

    if (action === "fix-security" && !participant.achievements.includes("Security Expert")) {
      newAchievements.push("Security Expert");
    }

    if (action === "perfect-run" && !participant.achievements.includes("Clean Coder")) {
      newAchievements.push("Clean Coder");
    }

    return newAchievements;
  }
}

export const gamificationService = new GamificationService();
