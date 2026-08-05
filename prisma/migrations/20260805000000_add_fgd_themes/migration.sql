-- CreateTable
CREATE TABLE "FgdTheme" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FgdTheme_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FgdTheme_name_key" ON "FgdTheme"("name");

-- Seed default sessions (administrator can edit theme + add/remove anytime)
INSERT INTO "FgdTheme" ("id", "name", "theme", "order", "updatedAt") VALUES
  ('fgd-sesi-1', 'Sesi 1', '', 1, now()),
  ('fgd-sesi-2', 'Sesi 2', '', 2, now()),
  ('fgd-sesi-3', 'Sesi 3', '', 3, now()),
  ('fgd-sesi-4', 'Sesi 4', '', 4, now()),
  ('fgd-sesi-5', 'Sesi 5', '', 5, now());