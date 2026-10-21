-- ============================================================================
--  MediQueue - complete MySQL database in ONE file
--  Creates the database and app user, all 13 tables, and dummy records.
--
--  HOW TO RUN (pick one):
--    * MySQL Workbench: connect as root -> File > Open SQL Script -> this file
--      -> click the lightning bolt (Execute all).
--      Or copy everything, paste into a query tab, and Execute all.
--    * Command line:   mysql -u root -p < mediqueue_mysql.sql
--
--  WARNING: it DELETES any existing `mediqueue` database and starts fresh.
--  Needs MySQL 8.0 or newer.
--
--  LOGINS (website http://localhost:5173 after `npm run dev`):
--    admin@gmail.com        admin123
--    reception@gmail.com    reception123
--    doctor1@gmail.com      doctor123      (also doctor2, doctor3)
--    patient1@gmail.com     patient123     (also patient2 ... patient12)
--  All people and phone numbers are made up. Times are stored in UTC.
-- ============================================================================

SET NAMES utf8mb4;

-- ============================================================================
-- PART 1 - DATABASE AND APP USER
-- ============================================================================
DROP DATABASE IF EXISTS mediqueue;
CREATE DATABASE mediqueue CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The account the app uses (matches backend/.env):
--   DATABASE_URL="mysql://mediqueue:mediqueue123@localhost:3306/mediqueue"
CREATE USER IF NOT EXISTS 'mediqueue'@'localhost' IDENTIFIED BY 'mediqueue123';
GRANT ALL PRIVILEGES ON `mediqueue%`.* TO 'mediqueue'@'localhost';
FLUSH PRIVILEGES;

USE mediqueue;

-- ============================================================================
-- PART 2 - TABLES (13 app tables + Prisma's migration history)
-- ============================================================================

-- Clinic: name, time zone and queue policy (2 booked : 1 walk-in, grace and late minutes)
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

-- User: every account (patient, receptionist, doctor, admin). Passwords are bcrypt hashes
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

-- Session: signed-in sessions (only a SHA-256 of the cookie token is stored)
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Session_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Doctor: code (token prefix D01), department, room, default visit length
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

-- Slot: bookable appointment times with capacity and how many are reserved
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

-- Appointment: bookings (BOOKED, CHECKED_IN, CANCELLED, NO_SHOW, COMPLETED)
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

-- QueueCounter: last token number given out per doctor per day
CREATE TABLE `QueueCounter` (
    `doctorId` VARCHAR(191) NOT NULL,
    `serviceDate` VARCHAR(10) NOT NULL,
    `lastNumber` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`doctorId`, `serviceDate`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- DoctorQueueState: pause state and 2:1 rotation per doctor per day
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

-- QueueTicket: tokens issued at check-in (WAITING, CALLED, IN_CONSULTATION, COMPLETED, CANCELLED, SKIPPED)
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

-- Consultation: start and end of each visit (used for wait-time estimates)
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

-- Notification: in-app messages to patients
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

-- AuditEvent: who did what, when and why, with before/after values
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

-- IdempotencyRecord: stops a double-clicked booking from booking twice
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

-- Relationships between the tables (foreign keys)
ALTER TABLE `User` ADD CONSTRAINT `User_clinicId_fkey` FOREIGN KEY (`clinicId`) REFERENCES `Clinic`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Doctor` ADD CONSTRAINT `Doctor_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Doctor` ADD CONSTRAINT `Doctor_clinicId_fkey` FOREIGN KEY (`clinicId`) REFERENCES `Clinic`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Slot` ADD CONSTRAINT `Slot_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Appointment` ADD CONSTRAINT `Appointment_patientId_fkey` FOREIGN KEY (`patientId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Appointment` ADD CONSTRAINT `Appointment_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Appointment` ADD CONSTRAINT `Appointment_slotId_fkey` FOREIGN KEY (`slotId`) REFERENCES `Slot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `QueueCounter` ADD CONSTRAINT `QueueCounter_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `DoctorQueueState` ADD CONSTRAINT `DoctorQueueState_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `QueueTicket` ADD CONSTRAINT `QueueTicket_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `QueueTicket` ADD CONSTRAINT `QueueTicket_patientId_fkey` FOREIGN KEY (`patientId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `QueueTicket` ADD CONSTRAINT `QueueTicket_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `Appointment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Consultation` ADD CONSTRAINT `Consultation_queueTicketId_fkey` FOREIGN KEY (`queueTicketId`) REFERENCES `QueueTicket`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Consultation` ADD CONSTRAINT `Consultation_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `AuditEvent` ADD CONSTRAINT `AuditEvent_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Prisma's migration history: tells the app these tables already exist,
-- so `npm run dev` doesn't try to create them again.
CREATE TABLE `_prisma_migrations` (
    `id` VARCHAR(36) NOT NULL,
    `checksum` VARCHAR(64) NOT NULL,
    `finished_at` DATETIME(3) NULL,
    `migration_name` VARCHAR(255) NOT NULL,
    `logs` TEXT NULL,
    `rolled_back_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `applied_steps_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `_prisma_migrations` (`id`, `checksum`, `finished_at`, `migration_name`, `logs`, `rolled_back_at`, `started_at`, `applied_steps_count`) VALUES
('d9da3c85-e6c7-4e5a-84f8-b10208c07ac1', '45f38f5f4bc32377a9d5ff04c5037714d1cf882aefdd19720572a2549ace8945', UTC_TIMESTAMP(3), '20261020194601_init',           NULL, NULL, UTC_TIMESTAMP(3), 1),
('f15e47ed-41b2-48ea-b0b6-8b97dcab2910', 'c63c88d9d0608c8e35dd6cfd7d0b1ee1743ff27d0dd85605006beb8b6b026349', UTC_TIMESTAMP(3), '20261020211432_profile_avatar', NULL, NULL, UTC_TIMESTAMP(3), 1);

-- ============================================================================
-- PART 3 - DUMMY RECORDS
-- Everything is dated relative to the moment you run this file, so "today"
-- in the app is always your real today (India time).
-- ============================================================================

SET time_zone = '+00:00';                        -- the app stores every time in UTC
SET @now   = UTC_TIMESTAMP(3);
SET @today = DATE(@now + INTERVAL 330 MINUTE);   -- today's date in India (UTC+05:30)

-- Password hashes (bcrypt). The plain passwords are in the comments.
SET @pw_admin     = '$2a$10$YB5rJO7I1s.GMAfALCJFUuZP9fKw0pIuwppAyi2tZH9oVp2zQzyaO';   -- admin123
SET @pw_reception = '$2a$10$Is2rrYPcf9ikqg9vDi3Lru11MrXv78wFqy7s0SDiBXo034UCF3Smq';   -- reception123
SET @pw_doctor    = '$2a$10$YiiEn3AeWIxih2uxYGHxiuoXG1J8W3H8p63SRu/HQ3.XRk8IFok2S';   -- doctor123
SET @pw_patient   = '$2a$10$XhhG8mnXbg7aHKS98BMKw.esfqhqN5Ez4YqZyTOz9eq.LiJfNkiIa';   -- patient123

-- ---------------------------------------------------------------------------
-- 3.1  Clinic
-- ---------------------------------------------------------------------------
INSERT INTO Clinic (id, name, timezone, walkInRatio, graceMinutes, lateAfterMinutes, autoNoShow, defaultConsultMinutes, bookingHorizonDays, createdAt, updatedAt)
VALUES ('clinic-1', 'DemoCare OPD', 'Asia/Kolkata', 2, 15, 15, FALSE, 12, 14, @now - INTERVAL 60 DAY, @now);

-- ---------------------------------------------------------------------------
-- 3.2  Users: 1 admin, 1 receptionist, 3 doctors, 12 patients
-- ---------------------------------------------------------------------------
INSERT INTO User (id, email, passwordHash, name, phone, avatarUrl, role, clinicId, isActive, createdAt, updatedAt) VALUES
('u-admin',     'admin@gmail.com',     @pw_admin,     'Asha Verma',      '+91 98400 20001', NULL, 'ADMIN',        'clinic-1', TRUE, @now - INTERVAL 60 DAY, @now),
('u-reception', 'reception@gmail.com', @pw_reception, 'Ravi Kumar',      '+91 98400 20002', NULL, 'RECEPTIONIST', 'clinic-1', TRUE, @now - INTERVAL 60 DAY, @now),
('u-doctor1',   'doctor1@gmail.com',   @pw_doctor,    'Dr. Maya Iyer',   NULL,              NULL, 'DOCTOR',       'clinic-1', TRUE, @now - INTERVAL 60 DAY, @now),
('u-doctor2',   'doctor2@gmail.com',   @pw_doctor,    'Dr. Arjun Rao',   NULL,              NULL, 'DOCTOR',       'clinic-1', TRUE, @now - INTERVAL 60 DAY, @now),
('u-doctor3',   'doctor3@gmail.com',   @pw_doctor,    'Dr. Neha Shah',   NULL,              NULL, 'DOCTOR',       'clinic-1', TRUE, @now - INTERVAL 60 DAY, @now),
('u-p01',       'patient1@gmail.com',  @pw_patient,   'Aarav Menon',     '+91 98400 10001', NULL, 'PATIENT',      'clinic-1', TRUE, @now - INTERVAL 30 DAY, @now),
('u-p02',       'patient2@gmail.com',  @pw_patient,   'Diya Krishnan',   '+91 98400 10002', NULL, 'PATIENT',      'clinic-1', TRUE, @now - INTERVAL 30 DAY, @now),
('u-p03',       'patient3@gmail.com',  @pw_patient,   'Kabir Sethi',     '+91 98400 10003', NULL, 'PATIENT',      'clinic-1', TRUE, @now - INTERVAL 30 DAY, @now),
('u-p04',       'patient4@gmail.com',  @pw_patient,   'Ananya Pillai',   '+91 98400 10004', NULL, 'PATIENT',      'clinic-1', TRUE, @now - INTERVAL 30 DAY, @now),
('u-p05',       'patient5@gmail.com',  @pw_patient,   'Rohan Desai',     '+91 98400 10005', NULL, 'PATIENT',      'clinic-1', TRUE, @now - INTERVAL 30 DAY, @now),
('u-p06',       'patient6@gmail.com',  @pw_patient,   'Ishita Bose',     '+91 98400 10006', NULL, 'PATIENT',      'clinic-1', TRUE, @now - INTERVAL 30 DAY, @now),
('u-p07',       'patient7@gmail.com',  @pw_patient,   'Vihaan Nair',     '+91 98400 10007', NULL, 'PATIENT',      'clinic-1', TRUE, @now - INTERVAL 30 DAY, @now),
('u-p08',       'patient8@gmail.com',  @pw_patient,   'Meera Joshi',     '+91 98400 10008', NULL, 'PATIENT',      'clinic-1', TRUE, @now - INTERVAL 30 DAY, @now),
('u-p09',       'patient9@gmail.com',  @pw_patient,   'Farhan Qureshi',  '+91 98400 10009', NULL, 'PATIENT',      'clinic-1', TRUE, @now - INTERVAL 30 DAY, @now),
('u-p10',       'patient10@gmail.com', @pw_patient,   'Lakshmi Iyengar', '+91 98400 10010', NULL, 'PATIENT',      'clinic-1', TRUE, @now - INTERVAL 30 DAY, @now),
('u-p11',       'patient11@gmail.com', @pw_patient,   'Tanvi Shetty',    '+91 98400 10011', NULL, 'PATIENT',      'clinic-1', TRUE, @now - INTERVAL 30 DAY, @now),
('u-p12',       'patient12@gmail.com', @pw_patient,   'Dev Malhotra',    '+91 98400 10012', NULL, 'PATIENT',      'clinic-1', TRUE, @now - INTERVAL 30 DAY, @now);

-- ---------------------------------------------------------------------------
-- 3.3  Doctors (code = token prefix, avgMinutes = default visit length)
-- ---------------------------------------------------------------------------
INSERT INTO Doctor (id, userId, clinicId, code, department, room, avgMinutes, status, bio, createdAt, updatedAt) VALUES
('doc-d01', 'u-doctor1', 'clinic-1', 'D01', 'General Medicine', 'Room 101', 12, 'ACTIVE', 'Family physician focused on everyday outpatient care.', @now - INTERVAL 60 DAY, @now),
('doc-d02', 'u-doctor2', 'clinic-1', 'D02', 'Dermatology',      'Room 204', 10, 'ACTIVE', 'Skin, hair and nail consultations.',                   @now - INTERVAL 60 DAY, @now),
('doc-d03', 'u-doctor3', 'clinic-1', 'D03', 'Orthopedics',      'Room 310', 15, 'ACTIVE', 'Joint, bone and sports-injury outpatient care.',       @now - INTERVAL 60 DAY, @now);

-- ---------------------------------------------------------------------------
-- 3.4  Helper tables used only while loading (dropped at the end)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS seed_day, seed_sched, seed_num, seed_slot, seed_visit;

-- Days: the last 7 working days (Mon-Sat), today, and the next 14 days (no Sundays)
CREATE TABLE seed_day (d DATE PRIMARY KEY, kind VARCHAR(10) NOT NULL, n INT NOT NULL);
INSERT INTO seed_day (d, kind, n)
WITH RECURSIVE back_days (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM back_days WHERE i < 13)
SELECT d, 'history', rn FROM (
  SELECT DATE(@today - INTERVAL i DAY) AS d, ROW_NUMBER() OVER (ORDER BY i) AS rn
  FROM back_days WHERE DAYOFWEEK(@today - INTERVAL i DAY) <> 1
) x WHERE rn <= 7;                                   -- n = 1 is the most recent working day
INSERT INTO seed_day (d, kind, n)
WITH RECURSIVE next_days (i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM next_days WHERE i < 14)
SELECT d, IF(i = 0, 'today', 'future'), rn - 1 FROM (
  SELECT DATE(@today + INTERVAL i DAY) AS d, i, ROW_NUMBER() OVER (ORDER BY i) AS rn
  FROM next_days WHERE i = 0 OR DAYOFWEEK(@today + INTERVAL i DAY) <> 1
) x;                                                 -- n = 0 is today, 1 the next working day ...

-- Doctor sessions (India time)
CREATE TABLE seed_sched (doctorId VARCHAR(20), code CHAR(3), starts TIME, slotMin INT, slots INT, avgMin INT, k INT);
INSERT INTO seed_sched VALUES
('doc-d01', 'D01', '09:00:00', 15, 16, 12, 1),       -- 09:00-13:00, 15-minute slots
('doc-d02', 'D02', '10:00:00', 15, 16, 10, 2),       -- 10:00-14:00, 15-minute slots
('doc-d03', 'D03', '14:00:00', 20, 12, 15, 3);       -- 14:00-18:00, 20-minute slots

CREATE TABLE seed_num (i INT PRIMARY KEY);
INSERT INTO seed_num WITH RECURSIVE r (i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM r WHERE i < 15) SELECT i FROM r;

-- One row per slot (i = slot number within the session, starting at 0)
CREATE TABLE seed_slot AS
SELECT UUID() AS id, s.doctorId, s.code, s.k, s.slotMin, s.avgMin, d.d AS day, d.kind, d.n AS dn, n.i,
       CAST(TIMESTAMP(d.d, s.starts) - INTERVAL 330 MINUTE + INTERVAL (n.i * s.slotMin) MINUTE AS DATETIME(3)) AS startAt
FROM seed_day d CROSS JOIN seed_sched s JOIN seed_num n ON n.i < s.slots;

-- ---------------------------------------------------------------------------
-- 3.5  Slots (history + today + 14 days ahead)
-- ---------------------------------------------------------------------------
INSERT INTO Slot (id, doctorId, serviceDate, startAt, endAt, capacity, reservedCount, createdAt, updatedAt)
SELECT id, doctorId, DATE_FORMAT(day, '%Y-%m-%d'), startAt, startAt + INTERVAL slotMin MINUTE, 1, 0, @now - INTERVAL 15 DAY, @now
FROM seed_slot;

-- ---------------------------------------------------------------------------
-- 3.6  History: completed visits and no-shows for the last 7 working days
--      (gives the wait-time estimates and the admin charts real numbers)
-- ---------------------------------------------------------------------------
CREATE TABLE seed_visit AS
SELECT UUID() AS apptId, UUID() AS ticketId, UUID() AS consultId,
       v.*,
       v.startAt - INTERVAL 5 MINUTE                         AS checkedInAt,
       v.startAt + INTERVAL (2 + v.i) MINUTE                 AS calledAt,
       v.startAt + INTERVAL (3 + v.i) MINUTE                 AS startedAt,
       v.startAt + INTERVAL (3 + v.i + v.durMin) MINUTE      AS completedAt
FROM (
  SELECT ss.id AS slotId, ss.doctorId, ss.code, ss.k, ss.day, ss.dn, ss.i, ss.startAt,
         IF(ss.code = 'D01' AND ss.dn = 2 AND ss.i = 1, 'u-p01',
            CONCAT('u-p', LPAD(2 + MOD(ss.i + ss.dn * 5 + ss.k * 3, 11), 2, '0')))           AS patientId,
         IF(MOD(ss.i + ss.dn + ss.k, 9) = 4 AND NOT (ss.code = 'D01' AND ss.dn = 2 AND ss.i = 1),
            'NO_SHOW', 'COMPLETED')                                                        AS status,
         ss.avgMin + MOD(ss.i * 3 + ss.dn, 5) - 2                                          AS durMin,
         (7 + ss.i + MOD(ss.i * 7 + ss.dn, 7) - 3) * 60                                    AS predictedWaitSec,
         (7 + ss.i + 6 - MOD(ss.i * 5 + ss.dn, 13)) * 60                                   AS baselineWaitSec
  FROM seed_slot ss
  WHERE ss.kind = 'history'
    AND (MOD(ss.i * 7 + ss.dn * 3 + ss.k, 10) < 6 OR (ss.code = 'D01' AND ss.dn = 2 AND ss.i = 1))
) v;
ALTER TABLE seed_visit ADD COLUMN token INT;
UPDATE seed_visit v JOIN (
  SELECT apptId, ROW_NUMBER() OVER (PARTITION BY doctorId, day ORDER BY i) AS t FROM seed_visit WHERE status = 'COMPLETED'
) x ON x.apptId = v.apptId SET v.token = x.t;

INSERT INTO Appointment (id, patientId, doctorId, slotId, serviceDate, status, bookedAt, checkedInAt, noShowAt, completedAt, createdAt, updatedAt)
SELECT apptId, patientId, doctorId, slotId, DATE_FORMAT(day, '%Y-%m-%d'), status,
       startAt - INTERVAL (1 + MOD(i + dn, 5)) DAY,
       IF(status = 'COMPLETED', checkedInAt, NULL),
       IF(status = 'NO_SHOW', startAt + INTERVAL 16 MINUTE, NULL),
       IF(status = 'COMPLETED', completedAt, NULL),
       startAt - INTERVAL (1 + MOD(i + dn, 5)) DAY, completedAt
FROM seed_visit;

INSERT INTO QueueTicket (id, doctorId, serviceDate, tokenNumber, tokenLabel, patientId, appointmentId, source, status, scheduledAt,
                         checkedInAt, calledAt, startedAt, completedAt, isLate, predictedWaitSec, baselineWaitSec, createdAt, updatedAt)
SELECT ticketId, doctorId, DATE_FORMAT(day, '%Y-%m-%d'), token, CONCAT(code, '-', LPAD(token, 3, '0')), patientId, apptId, 'SCHEDULED', 'COMPLETED', startAt,
       checkedInAt, calledAt, startedAt, completedAt, FALSE, predictedWaitSec, baselineWaitSec, checkedInAt, completedAt
FROM seed_visit WHERE status = 'COMPLETED';

INSERT INTO Consultation (id, queueTicketId, doctorId, startedAt, endedAt, durationSec, createdAt)
SELECT consultId, ticketId, doctorId, startedAt, completedAt, durMin * 60, startedAt
FROM seed_visit WHERE status = 'COMPLETED';

INSERT INTO QueueCounter (doctorId, serviceDate, lastNumber)
SELECT doctorId, DATE_FORMAT(day, '%Y-%m-%d'), MAX(token) FROM seed_visit WHERE status = 'COMPLETED' GROUP BY doctorId, day;

INSERT INTO DoctorQueueState (doctorId, serviceDate, appointmentStreak, activeTicketId, paused, updatedAt)
SELECT doctorId, DATE_FORMAT(day, '%Y-%m-%d'), 0, NULL, FALSE, MAX(completedAt) FROM seed_visit GROUP BY doctorId, day;

-- ---------------------------------------------------------------------------
-- 3.7  Today: Dr. Maya Iyer (D01) queue
--      D01-001 done, D01-002 with the doctor, D01-003 walk-in waiting,
--      D01-004 Aarav (patient1) waiting, D01-005 walk-in waiting.
--      By the 2:1 rule the next call is the walk-in D01-003.
-- ---------------------------------------------------------------------------
SET @d01_s0 = (SELECT id FROM seed_slot WHERE code = 'D01' AND kind = 'today' AND i = 0);
SET @d01_s1 = (SELECT id FROM seed_slot WHERE code = 'D01' AND kind = 'today' AND i = 1);
SET @d01_s2 = (SELECT id FROM seed_slot WHERE code = 'D01' AND kind = 'today' AND i = 2);
SET @d02_s0 = (SELECT id FROM seed_slot WHERE code = 'D02' AND kind = 'today' AND i = 0);
SET @today_s = DATE_FORMAT(@today, '%Y-%m-%d');

INSERT INTO Appointment (id, patientId, doctorId, slotId, serviceDate, status, bookedAt, checkedInAt, completedAt, createdAt, updatedAt) VALUES
('appt-today-d01-1', 'u-p02', 'doc-d01', @d01_s0, @today_s, 'COMPLETED',  @now - INTERVAL 2 DAY, @now - INTERVAL 55 MINUTE, @now - INTERVAL 38 MINUTE, @now - INTERVAL 2 DAY, @now),
('appt-today-d01-2', 'u-p03', 'doc-d01', @d01_s1, @today_s, 'CHECKED_IN', @now - INTERVAL 2 DAY, @now - INTERVAL 46 MINUTE, NULL,                     @now - INTERVAL 2 DAY, @now),
('appt-today-d01-4', 'u-p01', 'doc-d01', @d01_s2, @today_s, 'CHECKED_IN', @now - INTERVAL 2 DAY, @now - INTERVAL 30 MINUTE, NULL,                     @now - INTERVAL 2 DAY, @now),
('appt-today-d02-1', 'u-p09', 'doc-d02', @d02_s0, @today_s, 'CHECKED_IN', @now - INTERVAL 2 DAY, @now - INTERVAL 10 MINUTE, NULL,                     @now - INTERVAL 2 DAY, @now);

INSERT INTO QueueTicket (id, doctorId, serviceDate, tokenNumber, tokenLabel, patientId, appointmentId, source, status, scheduledAt,
                         checkedInAt, calledAt, startedAt, completedAt, isLate, predictedWaitSec, baselineWaitSec, createdAt, updatedAt) VALUES
('tkt-d01-001', 'doc-d01', @today_s, 1, 'D01-001', 'u-p02', 'appt-today-d01-1', 'SCHEDULED', 'COMPLETED',
   (SELECT startAt FROM seed_slot WHERE id = @d01_s0), @now - INTERVAL 55 MINUTE, @now - INTERVAL 50 MINUTE, @now - INTERVAL 49 MINUTE, @now - INTERVAL 38 MINUTE, FALSE,  360,  720, @now - INTERVAL 55 MINUTE, @now),
('tkt-d01-002', 'doc-d01', @today_s, 2, 'D01-002', 'u-p03', 'appt-today-d01-2', 'SCHEDULED', 'IN_CONSULTATION',
   (SELECT startAt FROM seed_slot WHERE id = @d01_s1), @now - INTERVAL 46 MINUTE, @now - INTERVAL 7 MINUTE,  @now - INTERVAL 6 MINUTE,  NULL,                      FALSE, 1500, 1440, @now - INTERVAL 46 MINUTE, @now),
('tkt-d01-003', 'doc-d01', @today_s, 3, 'D01-003', 'u-p04', NULL,               'WALK_IN',   'WAITING',
   NULL,                                               @now - INTERVAL 40 MINUTE, NULL, NULL, NULL,                                                                 FALSE, 1800, 1440, @now - INTERVAL 40 MINUTE, @now),
('tkt-d01-004', 'doc-d01', @today_s, 4, 'D01-004', 'u-p01', 'appt-today-d01-4', 'SCHEDULED', 'WAITING',
   (SELECT startAt FROM seed_slot WHERE id = @d01_s2), @now - INTERVAL 30 MINUTE, NULL, NULL, NULL,                                                                 FALSE, 1680, 2160, @now - INTERVAL 30 MINUTE, @now),
('tkt-d01-005', 'doc-d01', @today_s, 5, 'D01-005', 'u-p05', NULL,               'WALK_IN',   'WAITING',
   NULL,                                               @now - INTERVAL 20 MINUTE, NULL, NULL, NULL,                                                                 FALSE, 2400, 2880, @now - INTERVAL 20 MINUTE, @now),
('tkt-d02-001', 'doc-d02', @today_s, 1, 'D02-001', 'u-p09', 'appt-today-d02-1', 'SCHEDULED', 'WAITING',
   (SELECT startAt FROM seed_slot WHERE id = @d02_s0), @now - INTERVAL 10 MINUTE, NULL, NULL, NULL,                                                                 FALSE,  600,  720, @now - INTERVAL 10 MINUTE, @now);

INSERT INTO Consultation (id, queueTicketId, doctorId, startedAt, endedAt, durationSec, createdAt) VALUES
('cons-d01-001', 'tkt-d01-001', 'doc-d01', @now - INTERVAL 49 MINUTE, @now - INTERVAL 38 MINUTE, 660,  @now - INTERVAL 49 MINUTE),
('cons-d01-002', 'tkt-d01-002', 'doc-d01', @now - INTERVAL 6 MINUTE,  NULL,                      NULL, @now - INTERVAL 6 MINUTE);

INSERT INTO QueueCounter (doctorId, serviceDate, lastNumber) VALUES ('doc-d01', @today_s, 5), ('doc-d02', @today_s, 1);
INSERT INTO DoctorQueueState (doctorId, serviceDate, appointmentStreak, activeTicketId, paused, updatedAt)
VALUES ('doc-d01', @today_s, 2, 'tkt-d01-002', FALSE, @now);

-- Today: bookings still waiting for reception to check them in
INSERT INTO Appointment (id, patientId, doctorId, slotId, serviceDate, status, bookedAt, createdAt, updatedAt)
SELECT UUID(), b.patientId, ss.doctorId, ss.id, @today_s, 'BOOKED', @now - INTERVAL 2 DAY, @now - INTERVAL 2 DAY, @now
FROM seed_slot ss JOIN (
            SELECT 'D02' AS code, 1 AS i, 'u-p06' AS patientId
  UNION ALL SELECT 'D02', 3, 'u-p07' UNION ALL SELECT 'D02', 5, 'u-p08' UNION ALL SELECT 'D02', 8, 'u-p02'
  UNION ALL SELECT 'D03', 0, 'u-p10' UNION ALL SELECT 'D03', 2, 'u-p11' UNION ALL SELECT 'D03', 4, 'u-p12' UNION ALL SELECT 'D03', 6, 'u-p06'
  UNION ALL SELECT 'D01', 5, 'u-p07' UNION ALL SELECT 'D01', 7, 'u-p08'
) b ON b.code = ss.code AND b.i = ss.i
WHERE ss.kind = 'today';

-- ---------------------------------------------------------------------------
-- 3.8  Future bookings (about one slot in three), plus patient1's own visits
-- ---------------------------------------------------------------------------
INSERT INTO Appointment (id, patientId, doctorId, slotId, serviceDate, status, bookedAt, createdAt, updatedAt)
SELECT 'appt-p01-next', 'u-p01', doctorId, id, DATE_FORMAT(day, '%Y-%m-%d'), 'BOOKED', @now - INTERVAL 20 HOUR, @now - INTERVAL 20 HOUR, @now
FROM seed_slot WHERE kind = 'future' AND code = 'D02' AND dn = 2 AND i = 2;

INSERT INTO Appointment (id, patientId, doctorId, slotId, serviceDate, status, bookedAt, cancelledAt, cancelReason, cancelledById, createdAt, updatedAt)
SELECT 'appt-p01-cancelled', 'u-p01', doctorId, id, DATE_FORMAT(day, '%Y-%m-%d'), 'CANCELLED', @now - INTERVAL 3 DAY, @now - INTERVAL 20 HOUR,
       'Cancelled by patient', 'u-p01', @now - INTERVAL 3 DAY, @now - INTERVAL 20 HOUR
FROM seed_slot WHERE kind = 'future' AND code = 'D03' AND dn = 4 AND i = 1;

INSERT INTO Appointment (id, patientId, doctorId, slotId, serviceDate, status, bookedAt, createdAt, updatedAt)
SELECT UUID(), CONCAT('u-p', LPAD(2 + MOD(FLOOR(i / 3) + dn * 4 + k * 2, 11), 2, '0')), doctorId, id, DATE_FORMAT(day, '%Y-%m-%d'), 'BOOKED',
       @now - INTERVAL (1 + MOD(i + dn, 4)) DAY, @now - INTERVAL (1 + MOD(i + dn, 4)) DAY, @now
FROM seed_slot
WHERE kind = 'future' AND MOD(i + dn + k, 3) = 0
  AND NOT (code = 'D02' AND dn = 2 AND i = 2)
  AND NOT (code = 'D03' AND dn = 4 AND i = 1);

-- Every slot's reservedCount = its active (not cancelled) bookings
UPDATE Slot s JOIN (
  SELECT slotId, COUNT(*) AS c FROM Appointment WHERE status <> 'CANCELLED' GROUP BY slotId
) a ON a.slotId = s.id
SET s.reservedCount = a.c;

-- ---------------------------------------------------------------------------
-- 3.9  Notifications (what patients see under the bell icon)
-- ---------------------------------------------------------------------------
SET @p01_next = (SELECT s.startAt FROM Appointment a JOIN Slot s ON s.id = a.slotId WHERE a.id = 'appt-p01-next');
SET @p01_today = (SELECT startAt FROM seed_slot WHERE id = @d01_s2);

INSERT INTO Notification (id, userId, kind, title, message, readAt, createdAt) VALUES
('note-1', 'u-p01', 'WELCOME', 'Welcome to MediQueue',
   'Book a visit at DemoCare OPD and follow your token live on arrival day.', @now - INTERVAL 29 DAY, @now - INTERVAL 30 DAY),
('note-2', 'u-p01', 'BOOKING_CONFIRMED', 'Appointment confirmed',
   CONCAT('Dr. Maya Iyer on ', DATE_FORMAT(@p01_today + INTERVAL 330 MINUTE, '%a, %e %b at %H:%i'), '. Check in at reception when you arrive.'),
   @now - INTERVAL 1 DAY, @now - INTERVAL 2 DAY),
('note-3', 'u-p01', 'BOOKING_CONFIRMED', 'Appointment confirmed',
   CONCAT('Dr. Arjun Rao on ', DATE_FORMAT(@p01_next + INTERVAL 330 MINUTE, '%a, %e %b at %H:%i'), '. Check in at reception when you arrive.'),
   NULL, @now - INTERVAL 20 HOUR),
('note-4', 'u-p01', 'CHECKED_IN', 'You''re checked in: token D01-004',
   'Please wait for Dr. Maya Iyer (Room 101). Estimated wait about 28 min.', NULL, @now - INTERVAL 30 MINUTE),
('note-5', 'u-p03', 'CALLED', 'Token D01-002: it''s your turn',
   'Please go to Room 101 to see Dr. Maya Iyer.', NULL, @now - INTERVAL 7 MINUTE);

-- ---------------------------------------------------------------------------
-- 3.10  Audit log (who did what, when, and why)
-- ---------------------------------------------------------------------------
INSERT INTO AuditEvent (id, actorId, actorRole, action, entityType, entityId, reason, beforeJson, afterJson, at) VALUES
(UUID(), 'u-admin',     'ADMIN',        'DEMO_SEEDED',       'Clinic',      'clinic-1',         NULL, NULL, '{"doctors":3,"patients":12,"historyDays":7}', @now - INTERVAL 90 MINUTE),
(UUID(), 'u-reception', 'RECEPTIONIST', 'CHECKED_IN',        'Appointment', 'appt-today-d01-1', NULL, NULL, '{"token":"D01-001"}', @now - INTERVAL 55 MINUTE),
(UUID(), 'u-doctor1',   'DOCTOR',       'QUEUE_CALLED',      'QueueTicket', 'tkt-d01-001',      NULL, NULL, NULL,                  @now - INTERVAL 50 MINUTE),
(UUID(), 'u-doctor1',   'DOCTOR',       'CONSULT_COMPLETED', 'QueueTicket', 'tkt-d01-001',      NULL, NULL, '{"durationSec":660}', @now - INTERVAL 38 MINUTE),
(UUID(), 'u-reception', 'RECEPTIONIST', 'CHECKED_IN',        'Appointment', 'appt-today-d01-2', NULL, NULL, '{"token":"D01-002"}', @now - INTERVAL 46 MINUTE),
(UUID(), 'u-reception', 'RECEPTIONIST', 'WALKIN_REGISTERED', 'QueueTicket', 'tkt-d01-003',      NULL, NULL, '{"token":"D01-003"}', @now - INTERVAL 40 MINUTE),
(UUID(), 'u-reception', 'RECEPTIONIST', 'CHECKED_IN',        'Appointment', 'appt-today-d01-4', NULL, NULL, '{"token":"D01-004"}', @now - INTERVAL 30 MINUTE),
(UUID(), 'u-reception', 'RECEPTIONIST', 'WALKIN_REGISTERED', 'QueueTicket', 'tkt-d01-005',      NULL, NULL, '{"token":"D01-005"}', @now - INTERVAL 20 MINUTE),
(UUID(), 'u-reception', 'RECEPTIONIST', 'CHECKED_IN',        'Appointment', 'appt-today-d02-1', NULL, NULL, '{"token":"D02-001"}', @now - INTERVAL 10 MINUTE),
(UUID(), 'u-doctor1',   'DOCTOR',       'QUEUE_CALLED',      'QueueTicket', 'tkt-d01-002',      NULL, NULL, NULL,                  @now - INTERVAL 7 MINUTE),
(UUID(), 'u-doctor1',   'DOCTOR',       'CONSULT_STARTED',   'QueueTicket', 'tkt-d01-002',      NULL, NULL, NULL,                  @now - INTERVAL 6 MINUTE);

-- Two pauses earlier this week (doctor stepped away, with the reason)
INSERT INTO AuditEvent (id, actorId, actorRole, action, entityType, entityId, reason, beforeJson, afterJson, at)
SELECT UUID(), 'u-doctor2', 'DOCTOR', 'QUEUE_PAUSED',  'Doctor', 'doc-d02', 'Called to assist a colleague', '{"paused":false}', '{"paused":true}',
       TIMESTAMP(d, '11:10:00') - INTERVAL 330 MINUTE FROM seed_day WHERE kind = 'history' AND n = 3
UNION ALL
SELECT UUID(), 'u-doctor2', 'DOCTOR', 'QUEUE_RESUMED', 'Doctor', 'doc-d02', NULL, '{"paused":true}', '{"paused":false}',
       TIMESTAMP(d, '11:30:00') - INTERVAL 330 MINUTE FROM seed_day WHERE kind = 'history' AND n = 3
UNION ALL
SELECT UUID(), 'u-doctor3', 'DOCTOR', 'QUEUE_PAUSED',  'Doctor', 'doc-d03', 'Equipment check in procedure room', '{"paused":false}', '{"paused":true}',
       TIMESTAMP(d, '16:00:00') - INTERVAL 330 MINUTE FROM seed_day WHERE kind = 'history' AND n = 2
UNION ALL
SELECT UUID(), 'u-doctor3', 'DOCTOR', 'QUEUE_RESUMED', 'Doctor', 'doc-d03', NULL, '{"paused":true}', '{"paused":false}',
       TIMESTAMP(d, '16:15:00') - INTERVAL 330 MINUTE FROM seed_day WHERE kind = 'history' AND n = 2;

-- Remove the loading helpers
DROP TABLE seed_visit, seed_slot, seed_num, seed_sched, seed_day;

-- ============================================================================
-- PART 4 - CHECK IT WORKED (these just display results)
-- ============================================================================

-- How many rows are in each table
SELECT 'Clinic' AS table_name, COUNT(*) AS row_count FROM Clinic
UNION ALL SELECT 'User',             COUNT(*) FROM User
UNION ALL SELECT 'Doctor',           COUNT(*) FROM Doctor
UNION ALL SELECT 'Slot',             COUNT(*) FROM Slot
UNION ALL SELECT 'Appointment',      COUNT(*) FROM Appointment
UNION ALL SELECT 'QueueTicket',      COUNT(*) FROM QueueTicket
UNION ALL SELECT 'Consultation',     COUNT(*) FROM Consultation
UNION ALL SELECT 'QueueCounter',     COUNT(*) FROM QueueCounter
UNION ALL SELECT 'DoctorQueueState', COUNT(*) FROM DoctorQueueState
UNION ALL SELECT 'Notification',     COUNT(*) FROM Notification
UNION ALL SELECT 'AuditEvent',       COUNT(*) FROM AuditEvent;

-- Accounts you can sign in with
SELECT name, email, role FROM User ORDER BY FIELD(role, 'ADMIN', 'RECEPTIONIST', 'DOCTOR', 'PATIENT'), LENGTH(email), email;

-- Today's queue (India time)
SELECT t.tokenLabel, u.name AS patient, t.source, t.status,
       TIME_FORMAT(CONVERT_TZ(t.checkedInAt, '+00:00', '+05:30'), '%H:%i') AS checked_in_ist
FROM QueueTicket t JOIN User u ON u.id = t.patientId
WHERE t.serviceDate = DATE_FORMAT(UTC_TIMESTAMP() + INTERVAL 330 MINUTE, '%Y-%m-%d')
ORDER BY t.tokenLabel;

-- ============================================================================
-- MORE HANDY QUERIES (remove the leading "-- " to run one)
-- ============================================================================
-- Doctors:
--   SELECT d.code, u.name, d.department, d.room, d.avgMinutes FROM Doctor d JOIN User u ON u.id = d.userId;
-- Today's appointments:
--   SELECT CONVERT_TZ(s.startAt, '+00:00', '+05:30') AS time_ist, u.name, a.status
--   FROM Appointment a JOIN Slot s ON s.id = a.slotId JOIN User u ON u.id = a.patientId
--   WHERE a.serviceDate = DATE_FORMAT(UTC_TIMESTAMP() + INTERVAL 330 MINUTE, '%Y-%m-%d') ORDER BY s.startAt;
-- Average visit length per doctor:
--   SELECT d.code, ROUND(AVG(c.durationSec) / 60, 1) AS avg_min, COUNT(*) AS visits
--   FROM Consultation c JOIN Doctor d ON d.id = c.doctorId WHERE c.durationSec IS NOT NULL GROUP BY d.code;
-- Latest audit entries:
--   SELECT at, actorRole, action, entityType, reason FROM AuditEvent ORDER BY at DESC LIMIT 20;
-- Patient1's appointments:
--   SELECT a.serviceDate, a.status, u.name AS doctor FROM Appointment a
--   JOIN Doctor d ON d.id = a.doctorId JOIN User u ON u.id = d.userId
--   WHERE a.patientId = 'u-p01' ORDER BY a.serviceDate;
--
-- Note: don't create logins by INSERTing plain passwords - they must be bcrypt
-- hashes. Use the app (Register page, or Admin > People > Add staff member).
-- ============================================================================
