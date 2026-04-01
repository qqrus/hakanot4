const colors = ["#39d0a0", "#5ea7ff", "#ff9d5c", "#f36cab", "#d4ff57"] as const;
const animals = ["Fox", "Otter", "Falcon", "Panda", "Lynx", "Robin"] as const;
const storageKey = "collabcode-tab-identity";

export interface LocalIdentity {
  id: string;
  name: string;
  color: string;
  avatar: string;
  xp: number;
  level: number;
  rank: string;
  isAnonymous: boolean;
  achievements: string[];
}

function createIdentity(): LocalIdentity {
  const seed = Math.floor(Math.random() * 1000);
  const animal = animals[seed % animals.length] ?? "Coder";

  return {
    id: `user_${crypto.randomUUID()}`,
    name: `${animal} ${seed}`,
    color: colors[seed % colors.length] ?? colors[0],
    avatar: animal.slice(0, 2).toUpperCase(),
    xp: 0,
    level: 1,
    rank: "Новичок",
    isAnonymous: false,
    achievements: [],
  };
}

export function getLocalIdentity(): LocalIdentity | null {
  if (typeof window === "undefined") {
    return null;
  }

  const saved = window.sessionStorage.getItem(storageKey);
  if (saved) {
    return JSON.parse(saved) as LocalIdentity;
  }

  const identity = createIdentity();
  window.sessionStorage.setItem(storageKey, JSON.stringify(identity));
  return identity;
}

export function rotateLocalIdentity(): LocalIdentity | null {
  if (typeof window === "undefined") {
    return null;
  }

  const identity = createIdentity();
  window.sessionStorage.setItem(storageKey, JSON.stringify(identity));
  return identity;
}

export function updateLocalIdentity(identity: LocalIdentity): void {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(storageKey, JSON.stringify(identity));
}
