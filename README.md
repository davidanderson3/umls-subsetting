# UMLS Subsetter

Creates a subset of the UMLS filtered by source vocabulary.

## Getting Started

1. Install Node.js & npm  
   Windows:  
       Download the Windows Installer (.msi) from https://nodejs.org and run it.  
   macOS:  
       brew install node  

2. Install Angular CLI (optional)  
       npm install -g @angular/cli  

3. Install dependencies  
   Backend:  
       cd backend  
       npm install  
   Frontend:  
       cd ../frontend  
       npm install  

4. Add Metathesaurus files  
   Copy your UMLS Metathesaurus RRF files (MRCONSO.RRF, MRREL.RRF, etc.) into:  
       backend/META/ 

5. Run precompute  
       cd backend  
       node precompute.js  

6. Run subsetting  
       node subsetting.js  

7. Serve the Angular frontend  
       cd ../frontend  
       ng serve  

8. Visit the app  
   Open your browser to:  
       http://localhost:4200  
