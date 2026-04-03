CREATE TABLE `Salon` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 1,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Salon_name_key`(`name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `Salon` (`id`, `name`, `sortOrder`, `active`, `createdAt`, `updatedAt`)
VALUES ('s1', 'Salon Principal', 1, true, NOW(3), NOW(3));

ALTER TABLE `DiningTable`
  ADD COLUMN `salonId` VARCHAR(191) NULL,
  ADD COLUMN `active` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `qrStatus` ENUM('PENDING', 'GENERATED', 'PRINTED') NOT NULL DEFAULT 'PENDING',
  ADD COLUMN `qrToken` VARCHAR(191) NULL,
  ADD COLUMN `qrGeneratedAt` DATETIME(3) NULL,
  ADD COLUMN `qrPrintedAt` DATETIME(3) NULL;

UPDATE `DiningTable` SET `salonId` = 's1' WHERE `salonId` IS NULL;

ALTER TABLE `DiningTable`
  MODIFY `salonId` VARCHAR(191) NOT NULL;

DROP INDEX `DiningTable_number_key` ON `DiningTable`;
CREATE UNIQUE INDEX `DiningTable_salonId_number_key` ON `DiningTable`(`salonId`, `number`);
CREATE UNIQUE INDEX `DiningTable_qrToken_key` ON `DiningTable`(`qrToken`);

ALTER TABLE `DiningTable`
  ADD CONSTRAINT `DiningTable_salonId_fkey`
  FOREIGN KEY (`salonId`) REFERENCES `Salon`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
