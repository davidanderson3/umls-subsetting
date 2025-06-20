import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SubsettingComponent } from './subsetting.component';

describe('SubsettingComponent', () => {
  let component: SubsettingComponent;
  let fixture: ComponentFixture<SubsettingComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ SubsettingComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SubsettingComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
