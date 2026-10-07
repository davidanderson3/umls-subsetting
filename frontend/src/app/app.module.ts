import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { HomeComponent } from './home/home.component';
import { HttpClientModule } from '@angular/common/http';
import { SubsettingComponent } from './subsetting/subsetting.component';
import { FormsModule } from '@angular/forms'; 
import { AdminComponent } from './admin/admin.component'; 
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTableModule } from '@angular/material/table'; // For MatTable
import { MatButtonModule } from '@angular/material/button'; // For MatButton
import { MatPaginatorModule } from '@angular/material/paginator'; // Optional, for pagination
import { MatSortModule } from '@angular/material/sort';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations'; 
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { SubsetProgressComponent } from './subset-progress/subset-progress.component';
import { MatProgressBarModule } from '@angular/material/progress-bar';

@NgModule({
  declarations: [
    AppComponent,
    HomeComponent,
    SubsettingComponent,
    AdminComponent,
    SubsetProgressComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    HttpClientModule,
    FormsModule,
    MatTableModule,  
    MatCheckboxModule,     
    MatButtonModule,     
    MatPaginatorModule,  
    MatSortModule, 
    BrowserAnimationsModule,  
    MatSelectModule,
    MatFormFieldModule, 
    MatProgressBarModule,
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
