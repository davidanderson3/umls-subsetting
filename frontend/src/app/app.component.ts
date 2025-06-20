import { Component, OnInit } from '@angular/core';
import { SourcesService } from './sources.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  title = 'metamorphosys';
  sources: any;

  constructor(private sourcesService: SourcesService) { }

  ngOnInit(): void {
    this.sourcesService.getSources().subscribe(
      data => {
        this.sources = data;
        console.log(data);
      },
      error => {
        console.error('Error fetching sources', error);
      }
    );
  }
}
