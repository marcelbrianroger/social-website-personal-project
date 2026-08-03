-- CreateEnum
CREATE TYPE "moderation_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "room_kind" AS ENUM ('WEREWOLF', 'MR_WHITE');

-- CreateEnum
CREATE TYPE "room_status" AS ENUM ('LOBBY', 'IN_PROGRESS', 'FINISHED');

-- CreateTable
CREATE TABLE "dudu_messages" (
    "id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "nickname" VARCHAR(48) NOT NULL,
    "body" VARCHAR(280) NOT NULL,
    "moderation_status" "moderation_status" NOT NULL DEFAULT 'PENDING',
    "moderation_reason" VARCHAR(256),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dudu_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_rooms" (
    "id" UUID NOT NULL,
    "code" VARCHAR(8) NOT NULL,
    "kind" "room_kind" NOT NULL,
    "status" "room_status" NOT NULL DEFAULT 'LOBBY',
    "host_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "game_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_members" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "nickname" VARCHAR(48) NOT NULL,
    "secret_role" VARCHAR(32),
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_dudu_messages_expires_at" ON "dudu_messages"("expires_at");

-- CreateIndex
CREATE INDEX "idx_dudu_messages_status_created_at" ON "dudu_messages"("moderation_status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "game_rooms_code_key" ON "game_rooms"("code");

-- CreateIndex
CREATE INDEX "idx_game_rooms_expires_at" ON "game_rooms"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_room_members_room_id_session_id" ON "room_members"("room_id", "session_id");

-- AddForeignKey
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "game_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
