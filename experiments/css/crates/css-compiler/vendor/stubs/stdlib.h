#ifndef STDLIB_H
#define STDLIB_H
void *malloc(unsigned long);
void *calloc(unsigned long, unsigned long);
void *realloc(void *, unsigned long);
void free(void *);
void abort(void);
void exit(int);
#endif
