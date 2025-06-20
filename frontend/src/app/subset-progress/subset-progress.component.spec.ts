import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SubsetProgressComponent } from './subset-progress.component';

describe('SubsetProgressComponent', () => {
  let component: SubsetProgressComponent;
  let fixture: ComponentFixture<SubsetProgressComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ SubsetProgressComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SubsetProgressComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
