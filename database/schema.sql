-- MediQueue: table definitions only (MySQL 8), all 13 tables.
-- Reference copy. To set up a working database use ONE of:
--   npm run setup                         (creates these tables from backend/prisma/migrations + demo data)
--   mysql -u root -p < mediqueue_mysql.sql (these tables + demo data + migration history)
-- Creating the tables from this file alone leaves out Prisma's migration history, so the app
-- would try to create them again on start.

-- CreateTable
CREATE TABLE `Clinic` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'Asia/Kolkata',
    `walkInRatio` INTEGER NOT NULL DEFAULT 2,
    `graceMinutes` INTEGER NOT NULL DEFAULT 15,
    `lateAfterMinutes` INTEGER NOT NULL DEFAULT 15,
    `autoNoShow` BOOLEAN NOT NULL DEFAULT false,
    `defaultConsultMinutes` INTEGER NOT NULL DEFAULT 12,
    `bookingHorizonDays` INTEGER NOT NULL DEFAULT 14,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `avatarUrl` MEDIUMTEXT NULL,
    `role` VARCHAR(191) NOT NULL,
    `clinicId` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    INDEX `User_clinicId_role_idx`(`clinicId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Session_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Doctor` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `clinicId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `department` VARCHAR(191) NOT NULL,
    `room` VARCHAR(191) NOT NULL,
    `avgMinutes` INTEGER NOT NULL DEFAULT 12,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `bio` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Doctor_userId_key`(`userId`),
    UNIQUE INDEX `Doctor_clinicId_code_key`(`clinicId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Slot` (
    `id` VARCHAR(191) NOT NULL,
    `doctorId` VARCHAR(191) NOT NULL,
    `serviceDate` VARCHAR(10) NOT NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NOT NULL,
    `capacity` INTEGER NOT NULL DEFAULT 1,
    `reservedCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Slot_doctorId_serviceDate_idx`(`doctorId`, `serviceDate`),
    UNIQUE INDEX `Slot_doctorId_startAt_key`(`doctorId`, `startAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Appointment` (
    `id` VARCHAR(191) NOT NULL,
    `patientId` VARCHAR(191) NOT NULL,
    `doctorId` VARCHAR(191) NOT NULL,
    `slotId` VARCHAR(191) NOT NULL,
    `serviceDate` VARCHAR(10) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `bookedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `checkedInAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelReason` TEXT NULL,
    `cancelledById` VARCHAR(191) NULL,
    `noShowAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `lateOverrideReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Appointment_patientId_serviceDate_idx`(`patientId`, `serviceDate`),
    INDEX `Appointment_doctorId_serviceDate_idx`(`doctorId`, `serviceDate`),
    INDEX `Appointment_slotId_idx`(`slotId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QueueCounter` (
    `doctorId` VARCHAR(191) NOT NULL,
    `serviceDate` VARCHAR(10) NOT NULL,
    `lastNumber` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`doctorId`, `serviceDate`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DoctorQueueState` (
    `doctorId` VARCHAR(191) NOT NULL,
    `serviceDate` VARCHAR(10) NOT NULL,
    `appointmentStreak` INTEGER NOT NULL DEFAULT 0,
    `activeTicketId` VARCHAR(191) NULL,
    `paused` BOOLEAN NOT NULL DEFAULT false,
    `pauseReason` TEXT NULL,
    `pausedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`doctorId`, `serviceDate`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QueueTicket` (
    `id` VARCHAR(191) NOT NULL,
    `doctorId` VARCHAR(191) NOT NULL,
    `serviceDate` VARCHAR(10) NOT NULL,
    `tokenNumber` INTEGER NOT NULL,
    `tokenLabel` VARCHAR(191) NOT NULL,
    `patientId` VARCHAR(191) NOT NULL,
    `appointmentId` VARCHAR(191) NULL,
    `source` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `scheduledAt` DATETIME(3) NULL,
    `checkedInAt` DATETIME(3) NOT NULL,
    `calledAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `isLate` BOOLEAN NOT NULL DEFAULT false,
    `predictedWaitSec` INTEGER NULL,
    `baselineWaitSec` INTEGER NULL,
    `statusReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `QueueTicket_appointmentId_key`(`appointmentId`),
    INDEX `QueueTicket_doctorId_serviceDate_status_idx`(`doctorId`, `serviceDate`, `status`),
    INDEX `QueueTicket_patientId_serviceDate_idx`(`patientId`, `serviceDate`),
    UNIQUE INDEX `QueueTicket_doctorId_serviceDate_tokenNumber_key`(`doctorId`, `serviceDate`, `tokenNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Consultation` (
    `id` VARCHAR(191) NOT NULL,
    `queueTicketId` VARCHAR(191) NOT NULL,
    `doctorId` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `endedAt` DATETIME(3) NULL,
    `durationSec` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Consultation_queueTicketId_key`(`queueTicketId`),
    INDEX `Consultation_doctorId_endedAt_idx`(`doctorId`, `endedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditEvent` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `actorRole` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `reason` TEXT NULL,
    `beforeJson` TEXT NULL,
    `afterJson` TEXT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditEvent_at_idx`(`at`),
    INDEX `AuditEvent_action_at_idx`(`action`, `at`),
    INDEX `AuditEvent_entityType_entityId_idx`(`entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IdempotencyRecord` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `route` VARCHAR(191) NOT NULL,
    `requestHash` VARCHAR(191) NOT NULL,
    `responseCode` INTEGER NOT NULL,
    `responseJson` MEDIUMTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `IdempotencyRecord_expiresAt_idx`(`expiresAt`),
    UNIQUE INDEX `IdempotencyRecord_userId_route_key_key`(`userId`, `route`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_clinicId_fkey` FOREIGN KEY (`clinicId`) REFERENCES `Clinic`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Doctor` ADD CONSTRAINT `Doctor_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Doctor` ADD CONSTRAINT `Doctor_clinicId_fkey` FOREIGN KEY (`clinicId`) REFERENCES `Clinic`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Slot` ADD CONSTRAINT `Slot_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Appointment` ADD CONSTRAINT `Appointment_patientId_fkey` FOREIGN KEY (`patientId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Appointment` ADD CONSTRAINT `Appointment_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Appointment` ADD CONSTRAINT `Appointment_slotId_fkey` FOREIGN KEY (`slotId`) REFERENCES `Slot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QueueCounter` ADD CONSTRAINT `QueueCounter_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DoctorQueueState` ADD CONSTRAINT `DoctorQueueState_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QueueTicket` ADD CONSTRAINT `QueueTicket_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QueueTicket` ADD CONSTRAINT `QueueTicket_patientId_fkey` FOREIGN KEY (`patientId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QueueTicket` ADD CONSTRAINT `QueueTicket_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `Appointment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Consultation` ADD CONSTRAINT `Consultation_queueTicketId_fkey` FOREIGN KEY (`queueTicketId`) REFERENCES `QueueTicket`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Consultation` ADD CONSTRAINT `Consultation_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditEvent` ADD CONSTRAINT `AuditEvent_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

