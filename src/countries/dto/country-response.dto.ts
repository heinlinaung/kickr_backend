// src/countries/dto/country-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

// Swagger-only response shapes. Every response is wrapped as `{ data }` by
// the global TransformInterceptor, so each route documents its envelope.

export class RegionResponse {
  @ApiProperty({ example: 'yangon' })
  id: string;

  @ApiProperty({ example: 'Yangon' })
  name: string;
}

export class CountryResponse {
  @ApiProperty({ example: 'myanmar' })
  id: string;

  @ApiProperty({ example: 'Myanmar' })
  name: string;

  @ApiProperty({ example: 1 })
  sortOrder: number;

  @ApiProperty({
    type: [RegionResponse],
    example: [
      { id: 'yangon', name: 'Yangon' },
      { id: 'mandalay', name: 'Mandalay' },
    ],
  })
  regions: RegionResponse[];
}

export class CountryEnvelope {
  @ApiProperty({ type: CountryResponse })
  data: CountryResponse;
}

export class CountryListEnvelope {
  @ApiProperty({ type: [CountryResponse] })
  data: CountryResponse[];
}

export class CountryDeleted {
  @ApiProperty({ example: true })
  deleted: boolean;

  @ApiProperty({ example: 'myanmar' })
  id: string;
}

export class CountryDeletedEnvelope {
  @ApiProperty({ type: CountryDeleted })
  data: CountryDeleted;
}
