import { Module } from '@nestjs/common';
import { JobsController, ZooController } from './controllers';
import { ZooService } from './zoo.service';

@Module({
  controllers: [ZooController, JobsController],
  providers: [ZooService],
})
export class AppModule {}
