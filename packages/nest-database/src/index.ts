import { DynamicModule } from '@nestjs/common';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';

/**
 * TypeORM root module for a Nest app with a subset of core entities.
 */
export function typeOrmRootForEntities(
  entities: NonNullable<TypeOrmModuleOptions['entities']>,
): DynamicModule {
  return TypeOrmModule.forRootAsync({
    useFactory: (): TypeOrmModuleOptions => {
      const url = process.env.DATABASE_URL;
      if (url === undefined || url.length === 0) {
        throw new Error('DATABASE_URL is required');
      }
      return {
        type: 'postgres',
        url,
        entities,
        synchronize: false,
        logging: process.env.TYPEORM_LOGGING === 'true',
      };
    },
  });
}
