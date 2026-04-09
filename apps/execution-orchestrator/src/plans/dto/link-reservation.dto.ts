import { IsUUID } from 'class-validator';

export class LinkReservationDto {
  @IsUUID('4')
  capitalReservationId!: string;
}
